import { Elysia } from "elysia"

import { scanVideo } from "../lib/engine"
import { buildError } from "../lib/errors"
import { readRequestMeta } from "../lib/requestMeta"
import { persistVideoConversation } from "../lib/supabaseHistory"

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

type EngineRouteError = {
  code?: string
  message?: string
}

const scanErrorStatus = (code: string): number => {
  switch (code) {
    case "NO_PLAYERS_DETECTED":
      return 422
    case "VIDEO_DECODE_FAILED":
      return 422
    case "ENGINE_UNAVAILABLE":
      return 503
    default:
      return 500
  }
}

export default new Elysia().post("/api/scan-video", async ({ request, set }) => {
  const form = await request.formData()
  const value = form.get("video")
  const requestMeta = readRequestMeta(request)

  if (!(value instanceof File)) {
    set.status = 400
    return buildError("NO_FILE", "No video file provided.")
  }

  if (!value.type.startsWith("video/")) {
    set.status = 400
    return buildError("INVALID_FILE_TYPE", "Please upload a video file.")
  }

  if (value.size > MAX_FILE_SIZE_BYTES) {
    set.status = 413
    return buildError("FILE_TOO_LARGE", "File must be under 500MB.")
  }

  try {
    const result = await scanVideo(value)

    await persistVideoConversation({
      ...requestMeta,
      sessionToken: result.session_token,
      fileName: value.name || "unknown",
      fileMimeType: value.type || "application/octet-stream",
      fileSizeBytes: value.size,
      playerCount: result.player_count,
      players: result.players,
      scanResponse: result as Record<string, unknown>,
    })

    set.status = 200
    return result
  } catch (error) {
    const routeError = error as EngineRouteError
    const code = routeError.code ?? "UNKNOWN"
    set.status = scanErrorStatus(code)
    return buildError(code, routeError.message)
  }
})
