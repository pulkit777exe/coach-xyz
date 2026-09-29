import './instrument'

import * as Sentry from '@sentry/node'

import { startQueueInfrastructure } from './lib/queue'
import { logger } from './lib/logger'

import { buildApp, maxRequestBodySize } from './app'
import { historyStoreEnabled, initializeHistoryStore } from './lib/historyStore'
import { missingEnvVars } from './lib/env'

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
const missing = missingEnvVars(process.env, process.env.NODE_ENV)
if (missing.length > 0) {
  logger.error('missing_required_env', {
    type: 'missing_required_env',
    missing,
  })
  process.exit(1)
}

try {
  await initializeHistoryStore()
} catch (err) {
  logger.error('history_store_init_failed', {
    type: 'history_store_init_failed',
    error: err instanceof Error ? err.message : 'unknown',
  })
  // Continue — history is non-critical
}


const app = buildApp().listen({
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
