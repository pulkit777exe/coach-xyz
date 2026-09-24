import { Elysia } from 'elysia'

import { buildError, isCoachAIError } from './errors'
import { logger } from './logger'

// ── Global error handler (shared) ───────────────────────────────────────────
// Mounted on the production app (src/index.ts) AND the live smoke harness
// (scripts/smokeOrgHttp.ts) so escaping throws surface as JSON 500s with a
// logged stack in both — never as Elysia's empty-body default.
export const globalErrorHandler = new Elysia({ name: 'globalErrorHandler' }).onError(
  ({ error, set, request }) => {
    // If it's already a CoachAIError shape, pass it through
    if (isCoachAIError(error)) {
      set.status = error.retryable ? 503 : 500
      return error
    }
    // Routine 404s (unknown paths, scanners probing /v1/*) are not
    // application errors — skip the stack-trace log for them.
    const errStatus = (error as { status?: unknown; statusCode?: unknown }) ?? {}
    const httpStatus =
      typeof errStatus.status === 'number'
        ? errStatus.status
        : typeof errStatus.statusCode === 'number'
          ? errStatus.statusCode
          : 500
    if (httpStatus === 404) {
      set.status = 404
      return buildError('NOT_FOUND', undefined, false)
    }
    const e = error as { message?: string; stack?: string }
    logger.error('unhandled_error', {
      type: 'unhandled_error',
      error: e?.message,
      stack: e?.stack,
      path: new URL(request.url).pathname,
    })
    set.status = 500
    return buildError('INTERNAL_ERROR', undefined, true)
  },
)
