// ── App composition (no side effects) ───────────────────────────────────────
// The full Elysia route tree without listen(), env validation, queue start,
// or signal handlers — those stay in index.ts. Exported so tests (notably
// the authorization matrix) can drive the real composed app in-process via
// app.handle(). Call buildApp() once per process: the org/email/aiReports
// `.use(orgRoleGuard(...))` calls below decorate the shared route modules.

import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'

import { logger } from './lib/logger'
import { formatAccessLog, shouldLogRequest } from './lib/requestLog'
import { recordRequest } from './lib/metrics'
import { requestIdFrom } from './lib/engine'

import scanRoute from './routes/scan'
import analyzeRoute from './routes/analyze'
import statusRoute from './routes/status'
import jobEventsRoute from './routes/jobEvents'
import downloadRoute from './routes/download'
import chatRoute from './routes/chat'
import authRoute from './routes/auth'
import orgRoute from './routes/org'
import meRoute from './routes/me'
import emailRoute from './routes/email'
import membersRoute from './routes/members'
import teamsRoute from './routes/teams'
import notificationsRoute from './routes/notifications'
import aiReportsRoute from './routes/aiReports'
import shareRoute from './routes/share'
import { healthRoute } from './routes/health'
import { sportPositionsRoute } from './routes/sports'
import { globalErrorHandler } from './lib/httpErrors'
import { orgRoleGuard } from './lib/serviceGuard'
import { MAX_FILE_SIZE_BYTES } from './types'

export const maxRequestBodySize = Math.max(MAX_FILE_SIZE_BYTES + 10 * 1024 * 1024, 64 * 1024 * 1024)

// ── Request/access logging ────────────────────────────────────────────────────
// Start time + correlation id are stashed per Request in module-scope
// WeakMaps: onRequest seeds them (and echoes x-request-id), onAfterResponse
// emits the access line. onAfterResponse fires on EVERY response — success,
// error-hook, and unmatched-route 404 paths (verified against the installed
// Elysia 1.4 compose: the error paths schedule afterResponse hooks, and with
// app-level error hooks registered the general 404 routes through
// app.handleError). It runs via setImmediate after the response flushed —
// handler return values are never touched. `path` is the pathname ONLY.
const requestStartTimes = new WeakMap<Request, number>()
const requestIds = new WeakMap<Request, string>()

// Swagger docs are dev-only — don't expose the route surface in production.
const swaggerPlugin = () =>
  process.env.NODE_ENV === 'production'
    ? new Elysia({ name: 'swagger-disabled' })
    : swagger({
        path: '/swagger',
        documentation: {
          info: {
            title: 'CoachAI Middleware API',
            version: '2.0.0',
          },
        },
      })

export const buildApp = () => {
  return new Elysia({
    serve: {
      // Required for large multipart uploads; keep higher than route-level file cap.
      maxRequestBodySize,
    },
  })
    .use(
      cors({
        origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
        credentials: true,
      }),
    )
    // Root no-op onError: Elysia's unmatched-route 404 branch skips
    // afterResponse hooks unless app.event.error is non-empty (compose.js
    // checks `!app.event.error`, and an empty [] from .use()-transferring a
    // plugin onError counts as present-but-falsy). Registered inline, not .use()'d.
    // makes length === 1 so 404s run the access hook below too. Must return
    // undefined — a defined return would replace the 404 body (verified: the
    // body stays "NOT_FOUND" either way). Registered inline, not .use()'d.
    .onError(() => {})
    .onRequest(({ request, set }) => {
      const requestId = requestIdFrom(request)
      requestIds.set(request, requestId)
      requestStartTimes.set(request, Date.now())
      set.headers['x-request-id'] = requestId
    })
    .onAfterResponse(({ request, set, route }) => {
      const pathname = new URL(request.url).pathname
      if (!shouldLogRequest(pathname)) return
      const startedAt = requestStartTimes.get(request)
      const durationMs = startedAt === undefined ? 0 : Date.now() - startedAt
      const status = typeof set.status === 'number' ? set.status : 200
      // Same skip rule as the access log: the Render probe must not drown
      // the per-route counters it is meant to observe.
      recordRequest(request.method, typeof route === 'string' ? route : null, status, durationMs)
      logger.info(
        'request',
        formatAccessLog({
          method: request.method,
          path: pathname,
          status,
          durationMs,
          requestId: requestIds.get(request) ?? requestIdFrom(request),
        }),
      )
    })
    // ── Security Headers ───────────────────────────────────────────
    .onAfterHandle(({ set, request }) => {
      set.headers['X-Content-Type-Options'] = 'nosniff'
      set.headers['X-Frame-Options'] = 'DENY'
      set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
      set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'

      // Only set HSTS over HTTPS to avoid pinning localhost during development
      const isHttps = request.url.startsWith('https')
      if (isHttps) {
        set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
      }

      const isDev = process.env.NODE_ENV !== 'production'
      set.headers['Content-Security-Policy'] = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://browser.sentry-cdn.com https://js.sentry-cdn.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://*.auth0.com https://s.gravatar.com https://*.googleusercontent.com https://*.githubusercontent.com",
        `connect-src 'self' https://*.sentry.io https://*.upstash.io${isDev ? ' http://localhost:*' : ''}`,
        "worker-src 'self' blob:",
      ].join('; ')
    })
    .use(swaggerPlugin())
    .use(healthRoute)
    .use(sportPositionsRoute)
    .use(scanRoute)
    .use(analyzeRoute)
    .use(statusRoute)
    .use(jobEventsRoute)
    .use(downloadRoute)
    .use(chatRoute)
    .use(authRoute)
    .use(
      orgRoute.use(
        orgRoleGuard([
          'owner',
          'admin',
          'head_coach',
          'assistant_coach',
          'coach',
          'analyst',
          'medical',
        ]),
      ),
    )
    .use(meRoute)
    .use(emailRoute.use(orgRoleGuard(['owner', 'admin', 'head_coach', 'assistant_coach', 'coach'])))
    .use(membersRoute)
    .use(teamsRoute)
    .use(notificationsRoute)
    .use(
      aiReportsRoute.use(orgRoleGuard(['owner', 'admin', 'head_coach', 'assistant_coach', 'coach'])),
    )
    .use(shareRoute)

    // ── Global Error Handler ─────────────────────────────────────────────────
    .use(globalErrorHandler)
}
