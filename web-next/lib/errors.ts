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
    return { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', layer: 'client', retryable: true }
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