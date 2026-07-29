import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { readRequestMeta } from "../lib/requestMeta"
import { saveJob } from "../lib/jobs"
import { analysisQueue, type AnalysisPayload, JOB_PRIORITIES } from "../lib/queue"
import { checkAnalysisLimit, checkBetaCodeLimit, getIP, getBetaCode } from "../lib/ratelimit"
import { persistAnalysisStart } from "../lib/supabaseHistory"
import { DEFAULT_MODEL } from "../types"

type AnalyzeBody = {
  session_token: string | null
  player_index: number | null
  model?: string
  priority?: keyof typeof JOB_PRIORITIES
}

export default new Elysia().post("/api/analyze-video", async ({ request, set }) => {
  // ── Rate Limiting (per-IP) ─────────────────────────────────────────────
  const ip = getIP(request)
  const { allowed, remaining, reset } = await checkAnalysisLimit(ip)
  if (!allowed) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)
    set.status = 429
    return {
      ...buildError(
        "RATE_LIMITED",
        "Analysis limit reached (5 per hour). Try again later.",
        true,
      ),
      retry_after: retryAfter,
    }
  }

  // ── Rate Limiting (per-beta-code) ─────────────────────────────────────
  const betaCode = getBetaCode(request)
  if (betaCode) {
    const betaLimit = await checkBetaCodeLimit(betaCode)
    if (!betaLimit.allowed) {
      const retryAfter = Math.ceil((betaLimit.reset - Date.now()) / 1000)
      set.status = 429
      return {
        ...buildError(
          "RATE_LIMITED",
          "Beta code usage limit reached (20 per hour). Try again later.",
          true,
        ),
        retry_after: retryAfter,
      }
    }
  }

  // ── Validate Request ───────────────────────────────────────────────────
  let body: AnalyzeBody
  const requestMeta = readRequestMeta(request)

  try {
    body = (await request.json()) as AnalyzeBody
  } catch {
    set.status = 400
    return buildError("INVALID_REQUEST", "Invalid JSON request body.", false)
  }

  const sessionToken = body.session_token
  const playerIndex = body.player_index
  const model = body.model ?? DEFAULT_MODEL

  // Server-side priority determination (don't trust client input for priority)
  const priority = betaCode ? "beta" : "free"

  // Validate session_token format (must be UUID if provided)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (
    sessionToken !== null &&
    (typeof sessionToken !== "string" || !UUID_RE.test(sessionToken))
  ) {
    set.status = 400
    return buildError("INVALID_SESSION_TOKEN", "Session token must be a valid UUID.", false)
  }

  // Whitelist allowed models
  const ALLOWED_MODELS = [DEFAULT_MODEL]
  if (body.model && !ALLOWED_MODELS.includes(body.model)) {
    set.status = 400
    return buildError("INVALID_REQUEST", `Unsupported model: ${body.model}.`, false)
  }

  if (
    playerIndex !== null &&
    (!Number.isInteger(playerIndex) || playerIndex < 1)
  ) {
    set.status = 400
    return buildError("INVALID_PLAYER_INDEX", undefined, false)
  }

  // ── Create Job and Enqueue ─────────────────────────────────────────────
  try {
    const server_job_id = crypto.randomUUID()
    const engine_job_id = crypto.randomUUID()

    // 1. Save the server job mapping to Redis BEFORE enqueuing
    await saveJob({
      server_job_id,
      engine_job_id,
      session_token: sessionToken,
      player_index: playerIndex,
      model,
      created_at: Date.now(),
    })

    // 2. Enqueue — BullMQ worker calls engine /analyze which creates the engine job
    if (!analysisQueue) {
      set.status = 503
      return buildError("QUEUE_UNAVAILABLE", "Job queue is not configured.", true)
    }
    await analysisQueue.add(
      server_job_id,
      {
        server_job_id,
        engine_job_id,
        session_token: sessionToken,
        player_index: playerIndex,
      } satisfies AnalysisPayload,
      {
        priority: JOB_PRIORITIES[priority] ?? JOB_PRIORITIES.free,
      },
    )

    await persistAnalysisStart({
      ...requestMeta,
      serverJobId: server_job_id,
      engineJobId: engine_job_id,
      sessionToken,
      playerIndex,
      model,
    })

    set.status = 200
    return { job_id: server_job_id }
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "analyze_enqueue_error",
        message: (error as Error)?.message,
        stack: (error as Error)?.stack,
        timestamp: new Date().toISOString(),
      }),
    )
    set.status = 500
    return buildError("INTERNAL_ERROR", "Failed to enqueue analysis job. Please try again.", true)
  }
})
