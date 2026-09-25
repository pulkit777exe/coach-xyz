import './instrument'

import * as Sentry from '@sentry/node'
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'

import { startQueueInfrastructure } from './lib/queue'
import { logger } from './lib/logger'
import { formatAccessLog, shouldLogRequest } from './lib/requestLog'
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
import { historyStoreEnabled, initializeHistoryStore } from './lib/historyStore'
import { globalErrorHandler } from './lib/httpErrors'
import { orgRoleGuard } from './lib/serviceGuard'
import { MAX_FILE_SIZE_BYTES } from './types'

// ── Queue infrastructure ────────────────────────────────────────────────────
// Explicitly started (previously an import side effect of lib/queue) so
// importing the module stays inert in tests. First statement after imports —
// same position in the boot sequence the import-time start occupied: queues,
// workers, recovery/retention timers, and the shutdown signal handlers all
// exist before anything else runs, exactly once.
startQueueInfrastructure()

// ── Global Crash Prevention ─────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', {
    type: 'unhandled_rejection',
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  Sentry.captureException(reason)
})

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', {
    type: 'uncaught_exception',
    error: error.message,
    stack: error.stack,
  })
  Sentry.captureException(error)
  // Give in-flight requests time to drain, then exit
  setTimeout(() => process.exit(1), 1000)
})

// ── Validate Required Environment Variables ────────────────────────────────
const requiredEnvVars = [
  'ENGINE_URL',
  ...(process.env.NODE_ENV === 'production'
    ? ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SERVICE_TOKEN']
    : []),
]
const missingEnvVars = requiredEnvVars.filter((k) => !process.env[k])
if (missingEnvVars.length > 0) {
  logger.error('missing_required_env', {
    type: 'missing_required_env',
    missing: missingEnvVars,
  })
  process.exit(1)
}

const maxRequestBodySize = Math.max(MAX_FILE_SIZE_BYTES + 10 * 1024 * 1024, 64 * 1024 * 1024)

// ── Request/access logging ─────────────────────────────────────────────────
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

try {
  await initializeHistoryStore()
} catch (err) {
  logger.error('history_store_init_failed', {
    type: 'history_store_init_failed',
    error: err instanceof Error ? err.message : 'unknown',
  })
  // Continue — history is non-critical
}

// Swagger docs are dev-only — don't expose the route surface in production.
const swaggerPlugin =
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

const app = new Elysia({
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
  // ── Access log ─────────────────────────────────────────────────────
  // Root no-op onError: Elysia's unmatched-route 404 branch skips
  // afterResponse hooks unless app.event.error is non-empty (compose.js
  // checks `!app.event.error`, and an empty [] from .use()-transferring a
  // plugin onError counts as present-but-falsy). Registering directly here
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
  .onAfterResponse(({ request, set }) => {
    const pathname = new URL(request.url).pathname
    if (!shouldLogRequest(pathname)) return
    const startedAt = requestStartTimes.get(request)
    logger.info(
      'request',
      formatAccessLog({
        method: request.method,
        path: pathname,
        status: set.status ?? 200,
        durationMs: startedAt === undefined ? 0 : Date.now() - startedAt,
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
  .use(swaggerPlugin)
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
  .listen({
    port: Number(process.env.PORT) || 8000,
    maxRequestBodySize,
  })

logger.info('server_started', {
  type: 'server_started',
  port: app.server?.port,
  maxRequestBodySize,
})
logger.info('history_store_status', {
  type: 'history_store_status',
  enabled: historyStoreEnabled(),
})
logger.info('worker_started', { type: 'worker_started' })
