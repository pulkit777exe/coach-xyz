// ── Server Error Types ───────────────────────────────────────────────────────
// All errors returned by the server follow this shape.
// The "layer" field indicates where the error originated.

export interface CoachAIError {
  code: string
  message: string
  layer: "engine" | "server" | "client"
  retryable: boolean
  retry_after?: number
}

// ── Error Code Messages ──────────────────────────────────────────────────────
// Every error code used anywhere in the system has a user-friendly message here.
// Engine errors pass through with their own messages; these are fallbacks.

const FALLBACK_MESSAGES: Record<string, string> = {
  // Engine errors (passed through, these are fallbacks)
  NO_PLAYERS_DETECTED: "No players detected. Try better lighting or a less crowded frame.",
  VIDEO_DECODE_FAILED: "Could not read this video. Try MP4 or MOV format.",
  GEMINI_QUOTA_EXCEEDED: "AI quota reached. Try again in a few minutes.",
  GEMINI_TIMEOUT: "AI analysis timed out. Try a shorter video.",
  GEMINI_PARSE_FAILED: "AI returned unexpected response. Try again.",
  JOB_NOT_FOUND: "Session expired. Please upload your video again.",
  VIDEO_EXPIRED: "This video is no longer available. The server may have restarted. Please upload your video again.",
  ENGINE_UNAVAILABLE: "Analysis engine is temporarily unavailable.",
  INVALID_STATE_TRANSITION: "Analysis is in an unexpected state. Please retry.",
  REDIS_UNAVAILABLE: "Job storage is unavailable. Please try again later.",
  MEDIAPIPE_UNAVAILABLE: "Player detection is unavailable. Please try again.",
  STORAGE_ERROR: "Failed to save video. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",

  // Server errors
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  INVALID_BETA_CODE: "Invalid beta access code.",
  NO_FILE: "No video file provided.",
  INVALID_FILE_TYPE: "Please upload a video file.",
  FILE_TOO_LARGE: "File must be under 500MB.",
  INVALID_REQUEST: "Invalid request format.",
  INVALID_SESSION_TOKEN: "session_token must be null or a non-empty string.",
  INVALID_PLAYER_INDEX: "player_index must be null or a positive integer.",
  QUEUE_UNAVAILABLE: "Job queue is not configured. Please try again later.",
  ANALYSIS_FAILED: "Analysis failed after retries. Please try again.",
}

// ── Error Builders ───────────────────────────────────────────────────────────

/**
 * Build a server-side error with a user-friendly message.
 */
export function buildError(
  code: string,
  overrideMessage?: string,
  retryable = true,
): CoachAIError {
  return {
    code,
    message: overrideMessage ?? FALLBACK_MESSAGES[code] ?? "Something went wrong.",
    layer: "server",
    retryable,
  }
}

/**
 * Wrap an engine error into a CoachAIError.
 * Preserves the engine's code, message, and retryable flag.
 */
export function wrapEngineError(body: any): CoachAIError {
  return {
    code: body?.code ?? "ENGINE_ERROR",
    message: body?.message ?? FALLBACK_MESSAGES.ENGINE_UNAVAILABLE,
    layer: "engine",
    retryable: body?.retryable ?? true,
  }
}

/**
 * Build a client-side error (validation, network, etc.)
 */
export function buildClientError(
  code: string,
  message?: string,
  retryable = false,
): CoachAIError {
  return {
    code,
    message: message ?? FALLBACK_MESSAGES[code] ?? "Something went wrong.",
    layer: "client",
    retryable,
  }
}
