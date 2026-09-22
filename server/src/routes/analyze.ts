import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { readRequestMeta } from '../lib/requestMeta'
import { enqueueAnalysis } from '../lib/queue'
import { checkAnalysisLimit, getIP } from '../lib/ratelimit'
import { resolveJobCaller } from '../lib/jobAccess'
import { verifyAttributionToken } from '../lib/attribution'
import { persistAnalysisStart, checkOrgDailyQuota, getOrgTier, recordUsage } from '../lib/supabaseHistory'
import { listMembershipsForUser } from '../lib/orgMembers'
import { DEFAULT_MODEL } from '../types'

type AnalyzeBody = {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
  angle?: string | null
}

export default new Elysia().post('/api/analyze-video', async ({ request, set }) => {
  // ── Rate Limiting (per-IP, per-account when attributed) ────────────────
  const ip = getIP(request)
  const { allowed, reset } = await checkAnalysisLimit(resolveJobCaller(request) ?? ip)
  if (!allowed) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)
    set.status = 429
    return {
      ...buildError('RATE_LIMITED', 'Analysis limit reached (5 per hour). Try again later.', true),
      retry_after: retryAfter,
    }
  }

  // ── Validate Request ───────────────────────────────────────────────────
  let body: AnalyzeBody
  const requestMeta = readRequestMeta(request)

  try {
    body = (await request.json()) as AnalyzeBody
  } catch {
    set.status = 400
    return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
  }

  const sessionToken = body.session_token
  const playerIndex = body.player_index
  const videoKey = body.video_key ?? null
  const angle = typeof body.angle === 'string' ? body.angle : null

  // Validate session_token format (must be UUID if provided)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (sessionToken !== null && (typeof sessionToken !== 'string' || !UUID_RE.test(sessionToken))) {
    set.status = 400
    return buildError('INVALID_SESSION_TOKEN', 'Session token must be a valid UUID.', false)
  }

  if (playerIndex !== null && (!Number.isInteger(playerIndex) || playerIndex < 1)) {
    set.status = 400
    return buildError('INVALID_PLAYER_INDEX', undefined, false)
  }

  // ── Create Job and Enqueue ─────────────────────────────────────────────
  try {
    const server_job_id = crypto.randomUUID()
    const engine_job_id = crypto.randomUUID()
    const owner = verifyAttributionToken(request.headers.get('x-attribution'))

    // Per-org daily quota (§17): resolve the caller's primary org when
    // attributed; anonymous callers keep only the IP rate limit.
    let priority = 0
    if (owner) {
      const memberships = await listMembershipsForUser(owner).catch(() => [])
      const orgAuth0Id = memberships?.[0]?.org_auth0_id ?? owner
      const quota = await checkOrgDailyQuota(orgAuth0Id)
      if (!quota.allowed) {
        set.status = 429
        return {
          ...buildError(
            'RATE_LIMITED',
            'Organization daily analysis limit reached. Try again tomorrow.',
            true,
          ),
          retry_after: quota.retryAfterSec,
        }
      }
      // Fair queueing (§17): authenticated jobs outrank anonymous ones,
      // paid tiers outrank free. FIFO within a priority (no starvation).
      const tier = await getOrgTier(orgAuth0Id).catch(() => 'free' as const)
      priority = 5 + (tier === 'elite' ? 10 : tier === 'pro' ? 5 : 0)
      await recordUsage(orgAuth0Id, 'analysis').catch(() => {})
    }

    // Save the server job mapping to Redis BEFORE enqueuing
    await enqueueAnalysis({
      server_job_id,
      engine_job_id,
      session_token: sessionToken,
      player_index: playerIndex,
      video_key: videoKey,
      angle,
      priority,
      owner_ids: owner ? [owner] : [],
    })

    await persistAnalysisStart({
      ...requestMeta,
      serverJobId: server_job_id,
      engineJobId: engine_job_id,
      sessionToken,
      playerIndex,
      model: DEFAULT_MODEL,
      auth0Id: owner,
    })

    set.status = 200
    return { job_id: server_job_id }
  } catch (error) {
    if (error instanceof Error && error.message === 'QUEUE_UNAVAILABLE') {
      set.status = 503
      return buildError('QUEUE_UNAVAILABLE', 'Job queue is not configured.', true)
    }
    console.error(
      JSON.stringify({
        type: 'analyze_enqueue_error',
        message: (error as Error)?.message,
        stack: (error as Error)?.stack,
        timestamp: new Date().toISOString(),
      }),
    )
    set.status = 500
    return buildError('INTERNAL_ERROR', 'Failed to enqueue analysis job. Please try again.', true)
  }
})
