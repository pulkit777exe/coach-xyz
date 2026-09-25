import type { CoachAIError } from '@/types'

// ── Client Error Normalization ──────────────────────────────────────────────
// One place that converts unknown errors into the canonical CoachAIError shape
// and classifies them for retry decisions. Both the job poller and form
// handlers rely on these, instead of each caller re-literalizing the rules.

export function isCoachAIError(err: unknown): err is CoachAIError {
  if (!err || typeof err !== 'object') return false
  const obj = err as Record<string, unknown>
  return (
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.retryable === 'boolean'
  )
}

export function toCoachAIError(err: unknown): CoachAIError {
  // AbortError from AbortSignal.timeout()
  if (err instanceof DOMException && err.name === 'AbortError') {
    return {
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out.',
      layer: 'client',
      retryable: true,
    }
  }
  // Already a canonical CoachAIError (with code, message, retryable)
  if (isCoachAIError(err)) {
    return err
  }
  // Anything we cannot classify — treat as a client-side failure
  return { code: 'UNKNOWN', message: String(err), layer: 'client', retryable: false }
}

// Errors the poller should retry: request aborts and canonical errors the
// source marked retryable. Non-retryable errors will never succeed on retry.
export function isTransientError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return isCoachAIError(err) ? err.retryable !== false : false
}

/**
 * Build a CoachAIError from an HTTP error response. The single home for the
 * response-mapping rules apiFetch, the XHR upload paths, and the chat/SSE
 * streams previously re-literalized (with hand casts that let non-string
 * bodies through as `message`). Wire JSON is `any`-typed, so every field is
 * narrowed here — a numeric/object `message` falls back instead of leaking
 * a non-string into the UI:
 * - 429 → RATE_LIMITED with the server message + numeric retry_after.
 * - string code + string message → engine passthrough (layer/retryable
 *   defaulted, never re-derived).
 * - anything else → the caller's fallback code/message; retryable iff 5xx.
 */
export function errorFromResponse(
  status: number,
  rawBody: unknown,
  fallback: { code: string; message: string },
): CoachAIError {
  const body: Record<string, unknown> =
    typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {}
  const message = typeof body.message === 'string' ? body.message : undefined
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: message ?? fallback.message,
      layer: 'server',
      retryable: true,
      ...(typeof body.retry_after === 'number' ? { retry_after: body.retry_after } : {}),
    }
  }
  if (typeof body.code === 'string' && message !== undefined) {
    const layer = body.layer
    return {
      code: body.code,
      message,
      layer: layer === 'engine' || layer === 'server' || layer === 'client' ? layer : 'server',
      retryable: typeof body.retryable === 'boolean' ? body.retryable : true,
    }
  }
  return {
    code: fallback.code,
    message: fallback.message,
    layer: 'server',
    retryable: status >= 500,
  }
}
