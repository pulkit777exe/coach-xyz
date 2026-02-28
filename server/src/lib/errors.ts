import type { ErrorResponse } from "../types"

export const ERROR_MESSAGES: Record<string, string> = {
  NO_PLAYERS_DETECTED:
    "No players were detected in your video. Try better lighting, less crowding, or a clearer angle.",
  VIDEO_DECODE_FAILED:
    "We could not read this video. Please try MP4, MOV, or AVI format.",
  GEMINI_PARSE_FAILED:
    "AI analysis returned an unexpected result. Please try again.",
  GEMINI_QUOTA_EXCEEDED:
    "AI analysis limit reached. Please try again in a few minutes.",
  JOB_NOT_FOUND:
    "This analysis session has expired. Please upload your video again.",
  ENGINE_UNAVAILABLE:
    "Analysis service is temporarily unavailable. Please try again shortly.",
  UNKNOWN: "Something went wrong. Please try again.",
}

export const buildError = (
  code: string,
  overrideMessage?: string,
): ErrorResponse => ({
  error: code,
  message: ERROR_MESSAGES[code] ?? overrideMessage ?? ERROR_MESSAGES.UNKNOWN,
})
