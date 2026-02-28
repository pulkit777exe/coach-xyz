import { Elysia } from "elysia"

import { startAnalysis } from "../lib/engine"
import { buildError } from "../lib/errors"
import { createJob } from "../lib/jobs"

type AnalyzeBody = {
  session_token: string | null
  player_index: number | null
  model?: string
}

type EngineRouteError = {
  code?: string
  message?: string
}

export default new Elysia().post("/api/analyze-video", async ({ request, set }) => {
  let body: AnalyzeBody

  try {
    body = (await request.json()) as AnalyzeBody
  } catch {
    set.status = 400
    return buildError("INVALID_REQUEST", "Invalid JSON request body.")
  }

  const sessionToken = body.session_token
  const playerIndex = body.player_index
  const model = body.model ?? "gemini-2.5-flash"

  if (
    sessionToken !== null &&
    (typeof sessionToken !== "string" || sessionToken.trim().length === 0)
  ) {
    set.status = 400
    return buildError("INVALID_SESSION_TOKEN", "session_token must be null or a non-empty string.")
  }

  if (
    playerIndex !== null &&
    (!Number.isInteger(playerIndex) || playerIndex < 1)
  ) {
    set.status = 400
    return buildError("INVALID_PLAYER_INDEX", "player_index must be null or a positive integer.")
  }

  try {
    const engineResponse = await startAnalysis({
      session_token: sessionToken,
      player_index: playerIndex,
      model,
    })

    const serverJobId = crypto.randomUUID()
    createJob({
      job_id: serverJobId,
      engine_job_id: engineResponse.job_id,
      session_token: sessionToken,
      player_index: playerIndex,
    })

    set.status = 200
    return { job_id: serverJobId }
  } catch (error) {
    const routeError = error as EngineRouteError
    const code = routeError.code ?? "UNKNOWN"

    if (code === "ENGINE_UNAVAILABLE") {
      set.status = 503
      return buildError(code, routeError.message)
    }

    set.status = 500
    return buildError(code, routeError.message)
  }
})
