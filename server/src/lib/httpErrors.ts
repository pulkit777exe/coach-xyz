import { Elysia } from 'elysia'

import { buildError, isCoachAIError, type CoachAIError } from './errors'
import { requestIdFrom } from './engine'
import { logger } from './logger'

// ── Escaping-throw shaper (shared) ──────────────────────────────────────────
// A `.use(plugin)`-mounted onError is instance-scoped and never fires for
// other instances' routes, so the old `globalErrorHandler` export was
// decorative: escaping throws surfaced as plain-text 500s with the raw
// message. Register shapeEscapingError INLINE at the app root instead
// (root hooks are global). Returns undefined for 404s so their body and
// access hook survive. The plugin export stays for the smoke harness.
export const shapeEscapingError = (
  error: unknown,
  request: Request,
  set: { status?: number | string },
): CoachAIError | undefined => {
  if (isCoachAIError(error)) {
    set.status = error.retryable ? 503 : 500
    return error
  }
  const errStatus = (error as { status?: unknown; statusCode?: unknown }) ?? {}
  const httpStatus =
    typeof errStatus.status === 'number'
      ? errStatus.status
      : typeof errStatus.statusCode === 'number'
        ? errStatus.statusCode
        : 500
  // 404s are not application errors — pass through untouched.
  if (httpStatus === 404) {
    set.status = 404
    return undefined
  }
  const e = error as { message?: string; stack?: string }
  logger.error('unhandled_error', {
    type: 'unhandled_error',
    error: e?.message,
    stack: e?.stack,
    path: new URL(request.url).pathname,
    // The id the access log and engine calls already carry, so a Sentry
    // event joins its trace without AsyncLocalStorage.
    request_id: requestIdFrom(request),
  })
  // Never leak the raw message: an escaping throw is one no handler classified.
  set.status = 500
  return buildError('INTERNAL_ERROR', undefined, true)
}

export const globalErrorHandler = new Elysia({ name: 'globalErrorHandler' }).onError(
  ({ error, set, request }) => shapeEscapingError(error, request, set),
)
