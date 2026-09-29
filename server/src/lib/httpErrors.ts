import { Elysia } from 'elysia'

import { buildError, isCoachAIError, type CoachAIError } from './errors'
import { requestIdFrom } from './engine'
import { logger } from './logger'

// ── Escaping-throw shaper (shared) ──────────────────────────────────────────
// A `.use(plugin)`-mounted onError is instance-scoped: it never fires for
// routes of other instances, so the old `globalErrorHandler` export was
// decorative and escaping throws surfaced as plain-text 500s (raw message
// included — an information leak). The production app registers
// shapeEscapingError INLINE at its root (root onError hooks are global),
// which both shapes throws and keeps app.event.error non-empty so 404s
// still run afterResponse hooks. The plugin export stays for the live
// smoke harness, which mounts it the same decorative way.
export const shapeEscapingError = (
  error: unknown,
  request: Request,
  set: { status?: number | string },
): { body: CoachAIError } | undefined => {
  // Already shaped — pass through with the retryability-derived status.
  if (isCoachAIError(error)) {
    set.status = error.retryable ? 503 : 500
    return { body: error }
  }
  // Routine 404s (unknown paths, scanners probing /v1/*) are not
  // application errors: return undefined so the NOT_FOUND body and the
  // afterResponse access hook both survive.
  const errStatus = (error as { status?: unknown; statusCode?: unknown }) ?? {}
  const httpStatus =
    typeof errStatus.status === 'number'
      ? errStatus.status
      : typeof errStatus.statusCode === 'number'
        ? errStatus.statusCode
        : 500
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
    // Correlation without AsyncLocalStorage: the id the access log and
    // the engine calls already carry, so a Sentry event joins its trace.
    request_id: requestIdFrom(request),
  })
  // Never leak the raw message: an escaping throw is, by definition, one
  // no handler classified. Callers get the envelope + request_id header.
  set.status = 500
  return { body: buildError('INTERNAL_ERROR', undefined, true) }
}

export const globalErrorHandler = new Elysia({ name: 'globalErrorHandler' }).onError(
  ({ error, set, request }) => shapeEscapingError(error, request, set)?.body,
)
