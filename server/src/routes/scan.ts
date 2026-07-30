import { Elysia } from "elysia"

import { scanVideo } from "../lib/engine"
import { buildError, isCoachAIError } from "../lib/errors"
import { readRequestMeta } from "../lib/requestMeta"
import { checkScanLimit, getIP } from "../lib/ratelimit"
import { persistVideoConversation } from "../lib/supabaseHistory"
import { MAX_FILE_SIZE_BYTES } from "../types"

const scanErrorStatus = (code: string): number => {
  switch (code) {
    case "NO_PLAYERS_DETECTED":
      return 422
    case "VIDEO_DECODE_FAILED":
      return 422
    case "ENGINE_UNAVAILABLE":
      return 503
    case "MEDIAPIPE_UNAVAILABLE":
      return 503
    case "INVALID_REQUEST":
      return 400
    default:
      return 500
  }
}

export default new Elysia().post("/api/scan-video", async ({ request, set }) => {
  // ── Rate Limiting ──────────────────────────────────────────────────────
  const ip = getIP(request)
  const { allowed, remaining, reset } = await checkScanLimit(ip)
  set.headers["X-RateLimit-Remaining"] = String(remaining)
  if (!allowed) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)
    set.status = 429
    return {
      ...buildError(
        "RATE_LIMITED",
        "Too many scan requests. Wait a minute before trying again.",
        true,
      ),
      retry_after: retryAfter,
    }
  }

  // ── Reject oversized uploads before buffering into memory ─────────────
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_FILE_SIZE_BYTES) {
    set.status = 413
    return buildError("FILE_TOO_LARGE", "File must be under 500MB.", false)
  }

  // ── Validate Request ───────────────────────────────────────────────────
  const form = await request.formData()
  const value = form.get("video")
  const requestMeta = readRequestMeta(request)

  if (!(value instanceof File)) {
    set.status = 400
    return buildError("NO_FILE", "No video file provided.", false)
  }

  if (!value.type.startsWith("video/")) {
    set.status = 400
    return buildError("INVALID_FILE_TYPE", "Please upload a video file.", false)
  }

  if (value.size > MAX_FILE_SIZE_BYTES) {
    set.status = 413
    return buildError("FILE_TOO_LARGE", "File must be under 500MB.", false)
  }

  // ── Call Engine ────────────────────────────────────────────────────────
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
    // If the engine returned a structured error, pass it through
    if (isCoachAIError(error)) {
      set.status = scanErrorStatus(error.code)
      return error
    }

    // If it's a network/connectivity error
    const routeError = error as { code?: string; message?: string }
    if (routeError?.code === "ENGINE_UNAVAILABLE") {
      set.status = 503
      return buildError("ENGINE_UNAVAILABLE", "Analysis engine is temporarily unavailable.", true)
    }

    // Unknown error
    const code = routeError?.code ?? "UNKNOWN"
    set.status = scanErrorStatus(code)
    return buildError(code, routeError?.message)
  }
})
