// ── Server Error Types ───────────────────────────────────────────────────────
// Canonical error shape shared across all layers.
// The "layer" field indicates where the error originated.

import type { CoachAIError } from '../types'

export type { CoachAIError }

// ── Error Code Messages ──────────────────────────────────────────────────────
// Every error code used anywhere in the system has a user-friendly message here.
// Engine errors pass through with their own messages; these are fallbacks.
// Exported so contract tests (tests/errors.test.ts) can pin route messages to
// the canonical text instead of re-literalizing it.

export const FALLBACK_MESSAGES: Record<string, string> = {
  // Engine errors (passed through, these are fallbacks)
  NO_PLAYERS_DETECTED: 'No players detected. Try better lighting or a less crowded frame.',
  VIDEO_DECODE_FAILED: 'Could not read this video. Try MP4 or MOV format.',
  GEMINI_QUOTA_EXCEEDED: 'AI quota reached. Try again in a few minutes.',
  GEMINI_TIMEOUT: 'AI analysis timed out. Try a shorter video.',
  GEMINI_PARSE_FAILED: 'AI returned unexpected response. Try again.',
  JOB_NOT_FOUND: 'Session expired. Please upload your video again.',
  VIDEO_EXPIRED:
    'This video is no longer available. The server may have restarted. Please upload your video again.',
  VIDEO_NOT_FOUND: 'Rendered video is not available yet.',
  ENGINE_UNAVAILABLE: 'Analysis engine is temporarily unavailable.',
  ENGINE_ERROR: 'Analysis engine encountered an error.',
  UNKNOWN: 'An unknown error occurred.',
  INVALID_STATE_TRANSITION: 'Analysis is in an unexpected state. Please retry.',
  REDIS_UNAVAILABLE: 'Job storage is unavailable. Please try again later.',
  MEDIAPIPE_UNAVAILABLE: 'Player detection is unavailable. Please try again.',
  STORAGE_ERROR: 'Failed to save video. Please try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',

  // Server errors
  RATE_LIMITED: 'Too many requests. Please wait before trying again.',
  NO_FILE: 'No video file provided.',
  INVALID_FILE_TYPE: 'Please upload a video file.',
  FILE_TOO_LARGE: 'File must be under 500MB.',
  INVALID_REQUEST: 'Invalid request format.',
  INVALID_SESSION_TOKEN: 'session_token must be null or a non-empty string.',
  INVALID_PLAYER_INDEX: 'player_index must be null or a positive integer.',
  QUEUE_UNAVAILABLE: 'Job queue is not configured. Please try again later.',
  ANALYSIS_FAILED: 'Analysis failed after retries. Please try again.',
}

// ── Error Builders ───────────────────────────────────────────────────────────

/**
 * Build a server-side error with a user-friendly message.
 */
export function buildError(code: string, overrideMessage?: string, retryable = true): CoachAIError {
  return {
    code,
    message: overrideMessage ?? FALLBACK_MESSAGES[code] ?? 'Something went wrong.',
    layer: 'server',
    retryable,
  }
}

/**
 * Wrap an engine error into a CoachAIError.
 * Preserves the engine's code, message, and retryable flag.
 */
export function wrapEngineError(body: Partial<CoachAIError>): CoachAIError {
  return {
    code: body.code ?? 'ENGINE_ERROR',
    message: body.message ?? FALLBACK_MESSAGES.ENGINE_UNAVAILABLE,
    layer: 'engine',
    retryable: body.retryable ?? true,
  }
}

/**
 * Whether a queue should retry an engine error.
 *
 * The engine owns retryability (the `retryable` flag on every engine error);
 * the queue no longer re-literalizes a per-code policy. Only errors the
 * engine explicitly marks non-retryable are unrecoverable.
 */
export function isQueueRetryable(error: Pick<CoachAIError, 'retryable'>): boolean {
  return error.retryable !== false
}

// ── Status policy helpers ─────────────────────────────────────────────────────
// The ENGINE owns code → HTTP status (engine/core/errors.py STATUS_BY_CODE)
// and stamps it on the error at the wire: lib/engine's throwNonOk attaches
// the response's status to the thrown CoachAIError. The helpers below are the
// only sanctioned derivations from that stamp — each encodes ONE route
// posture, documented here, so routes never re-map codes to statuses
// themselves (the old per-route code → status hand-maps are gone).

/**
 * Pass-through posture (scan + download routes): surface the engine's own
 * HTTP status. When the engine never answered (connectivity loss → statusless
 * ENGINE_UNAVAILABLE, see lib/engine) map to 503; any other statusless error
 * takes `statuslessFallback` — the route's pre-parity default for
 * unclassified failures (scan: 500, download: 503).
 */
export function enginePassthroughStatus(error: CoachAIError, statuslessFallback = 500): number {
  if (error.status !== undefined) return error.status
  return error.code === 'ENGINE_UNAVAILABLE' ? 503 : statuslessFallback
}

/**
 * Chat posture (/api/chat/stream and chatHistory's
 * ask-analysis): the engine answered — a 4xx passes through, anything else
 * becomes 502 (a downstream failure is not the caller's). Returns null when
 * the error is statusless (the engine never answered) so the route applies
 * its own connectivity fallback instead.
 */
export function chatEngineStatus(error: CoachAIError): number | null {
  if (error.status === undefined) return null
  return error.status >= 400 && error.status < 500 ? error.status : 502
}

/**
 * The response body for an error: the CoachAIError shape without the
 * server-internal `status` stamp (the route sets the HTTP status from it
 * separately, via the posture helpers above).
 */
export function errorBody(error: CoachAIError): CoachAIError {
  const { status: _status, ...body } = error
  return body
}

/**
 * Build a wire failure for lib/engine's callers to THROW: the engine body
 * wrapped, with the HTTP status the engine answered stamped on it (stripped
 * from response bodies by errorBody, consumed by the posture helpers above).
 * Built in a function so `throw engineFailure(...)` stays a shaped
 * CoachAIError throw, not an object literal.
 */
export function engineFailure(body: Partial<CoachAIError>, status: number): CoachAIError {
  return { ...wrapEngineError(body), status }
}

/**
 * Type guard: check if an unknown value is a CoachAIError.
 */
export function isCoachAIError(value: unknown): value is CoachAIError {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    (obj.layer === 'engine' || obj.layer === 'server' || obj.layer === 'client') &&
    typeof obj.retryable === 'boolean'
  )
}
