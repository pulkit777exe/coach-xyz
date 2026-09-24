// ── Access log (pure helpers) ───────────────────────────────────────────────
// The Elysia hook wiring (start-time WeakMap, x-request-id echo, skip rule)
// lives in src/index.ts; everything here is pure so tests can pin the
// access-log contract without a running server.

/** Shallow /health is polled by Render/Docker HEALTHCHECK — skip only its
 *  exact pathname; /health/deep logs normally. */
export const shouldLogRequest = (pathname: string): boolean => pathname !== '/health'

export type AccessLogFields = {
  type: 'request'
  method: string
  path: string
  status: number | string
  duration_ms: number
  request_id: string
}

/** One access-log record. `path` is the pathname ONLY — never the query
 *  string (download routes carry x-attribution in query; tokens must not hit
 *  logs). Winston owns the `timestamp` field, so none is passed here. */
export const formatAccessLog = (fields: {
  method: string
  path: string
  status: number | string
  durationMs: number
  requestId: string
}): AccessLogFields => ({
  type: 'request',
  method: fields.method,
  path: fields.path,
  status: fields.status,
  duration_ms: Math.max(0, Math.round(fields.durationMs)),
  request_id: fields.requestId,
})
