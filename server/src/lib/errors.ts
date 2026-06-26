export interface CoachAIError {
  code: string
  message: string
  layer: "engine" | "server" | "queue" | "client"
  retryable: boolean
  job_id?: string
  retry_after?: number
}

const FALLBACK_MESSAGES: Record<string, string> = {
  NO_PLAYERS_DETECTED: "No players detected. Try better lighting.",
  VIDEO_DECODE_FAILED: "Could not read this video. Try MP4 or MOV.",
  GEMINI_QUOTA_EXCEEDED: "AI quota reached. Try again in a few minutes.",
  GEMINI_TIMEOUT: "AI timed out. Try a shorter video.",
  GEMINI_PARSE_FAILED: "AI returned unexpected response. Try again.",
  JOB_NOT_FOUND: "Session expired. Please upload your video again.",
  ENGINE_UNAVAILABLE: "Analysis engine is temporarily unavailable.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  INVALID_BETA_CODE: "Invalid beta access code.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NO_FILE: "No video file provided.",
  INVALID_FILE_TYPE: "Please upload a video file.",
  FILE_TOO_LARGE: "File must be under 500MB.",
  INVALID_REQUEST: "Invalid request format.",
  INVALID_SESSION_TOKEN: "session_token must be null or a non-empty string.",
  INVALID_PLAYER_INDEX: "player_index must be null or a positive integer.",
  ANALYSIS_FAILED: "Analysis failed after retries. Please try again.",
}

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

export function wrapEngineError(body: any): CoachAIError {
  return {
    code: body?.code ?? "ENGINE_ERROR",
    message: body?.message ?? "Engine error.",
    layer: "engine",
    retryable: body?.retryable ?? true,
  }
}
