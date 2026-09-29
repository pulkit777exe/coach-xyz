import { Elysia } from 'elysia'
import { ENGINE_URL } from '../lib/engine'
import { analysisQueue } from '../lib/queue'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { historyStoreEnabled, withHistoryStore } from '../lib/historyStore'

export const healthRoute = new Elysia({ prefix: '/health' })
  // Shallow — used by Render health check probe
  // Must always return 200 quickly
  .get('/', () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))
  // Deep — ops/queue-health probe (Redis + engine + queue depth) for manual
  // and external monitoring. No frontend consumer: the app pings shallow
  // /health only (web-next usePipeline keep-alive), as does the Docker
  // HEALTHCHECK.
  .get('/deep', async ({ set }) => {
    // Check Redis
    let redisOk = false
    let redisLatency = 0
    try {
      const t = Date.now()
      await Promise.race([
        redis.ping(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000)),
      ])
      redisOk = true
      redisLatency = Date.now() - t
    } catch (err) {
      logger.warn('health_check_degraded', {
        type: 'health_check_degraded',
        component: 'redis',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }

    // Check engine
    let engineOk = false
    let engineLatency = 0
    try {
      const t = Date.now()
      const res = await fetch(`${ENGINE_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      engineOk = res.ok
      engineLatency = Date.now() - t
    } catch (err) {
      logger.warn('health_check_degraded', {
        type: 'health_check_degraded',
        component: 'engine',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }

    // Check database (history/org store). A null store (DATABASE_URL unset)
    // or a failed ping degrades rather than fails boot, so it degrades
    // here too: the API serves but org features are off.
    let dbOk = false
    let dbLatency = 0
    try {
      const t = Date.now()
      const rows = await Promise.race([
        withHistoryStore(async (db) => db<{ ok: number }[]>`select 1 as ok`),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000)),
      ])
      dbOk = Array.isArray(rows) && rows.length > 0
      dbLatency = Date.now() - t
    } catch (err) {
      logger.warn('health_check_degraded', {
        type: 'health_check_degraded',
        component: 'database',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }

    // Check queue depth
    let waiting = 0
    let failed = 0
    try {
      if (analysisQueue) {
        waiting = await analysisQueue.getWaitingCount()
        failed = await analysisQueue.getFailedCount()
      }
    } catch (err) {
      logger.warn('health_check_degraded', {
        type: 'health_check_degraded',
        component: 'queue',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }

    const status = !redisOk
      ? 'unhealthy'
      : !engineOk || !dbOk
        ? 'degraded'
        : failed > 10
          ? 'degraded'
          : 'healthy'

    set.status = status === 'unhealthy' ? 503 : 200

    return {
      status,
      checks: {
        redis: { ok: redisOk, latency_ms: redisLatency },
        database: { ok: dbOk, latency_ms: dbLatency, enabled: historyStoreEnabled() },
        engine: { ok: engineOk, latency_ms: engineLatency },
        queue: { ok: true, waiting, failed },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })
