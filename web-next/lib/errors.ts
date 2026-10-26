import type { CoachAIError } from '@/types'

// ── Client Error Normalization ──────────────────────────────────────────────
// One place that converts unknown errors into the canonical CoachAIError shape
// and classifies them for retry decisions. Both the job poller and form
// handlers rely on these, instead of each caller re-literalizing the rules.

/**
 * Is this an abort rather than a transport failure?
 *
 * Duck-types on `name` instead of `instanceof DOMException`, because that check
 * misses Node's own `AbortError` (undici throws a plain `Error` with that name)
 * and any realm where `DOMException` is not the global constructor. Every client
 * timeout in this app is an abort, so getting this wrong reports a slow backend
 * as a dead connection.
 */
export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  )
}

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
  if (isAbortError(err)) {
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
  if (isAbortError(err)) return true
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

/**
 * Shape a client-layer failure: the browser refused the request before it was
 * sent (a wrong file type, an oversized upload, a user-cancelled scan), so
 * `layer` is always 'client'. Retryability is the caller's explicit verdict —
 * a cancelled scan is not a timeout and must not be retried. The counterpart to
 * `engineError`, and the reason callers do not hand-build the literal: this
 * module is the one place that decides what a `CoachAIError` looks like.
 */
export function clientError(code: string, message: string, retryable = false): CoachAIError {
  return { code, message, layer: 'client', retryable }
}

/**
 * Shape an engine-layer failure: the engine (or its SSE feed) reported the
 * problem, so layer is always 'engine' and retryability is the caller's
 * explicit verdict — never re-derived here. Consumed by the analysis
 * pipeline (completed-job errors, resume errors) and the scan SSE feed.
 */
export function engineError(
  code: string,
  message: string,
  retryable?: boolean | null,
): CoachAIError {
  return { code, message, layer: 'engine', retryable: retryable ?? true }
}

/**
 * A human-readable message for an unknown thrown value, with a fallback when it has none.
 *
 * This replaces FIVE local copies across the settings sections, in two variants that
 * DISAGREED on the case that matters most:
 *
 *   `errorMessage(error, fallback)` ×3  — checks `typeof message === 'string' && message.trim()`,
 *                                        so a blank message yields the fallback
 *   `messageOf(err, fallback)`      ×2  — checks only `typeof message === 'string'`, so a blank
 *                                        message yields `''`
 *
 * So `POST /members` failing with `message: ""` toasted the fallback on three sections and
 * **an empty toast** on the other two — the user sees a notification with no text and no
 * explanation. The blank-message guard is kept, because a blank string is the absence of a
 * message, not a message.
 *
 * It also handles the shapes the copies did not: an `Error` (whose `message` is on the
 * prototype chain but still readable), a `CoachAIError` (which passes through), and a
 * primitive (`throw 'nope'`) which stringifies rather than falling back.
 */
export function errorMessageOf(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  // An `Error` whose own `message` is blank but whose name is not — still say something.
  if (err instanceof Error && err.name && err.name !== 'Error') return err.name
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}
