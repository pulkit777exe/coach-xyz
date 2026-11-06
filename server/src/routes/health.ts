import { Elysia } from 'elysia'
import { ENGINE_URL } from '../lib/engine'
import { getAnalysisQueueStats } from '../lib/workerLifecycle'
import { withHistoryStore } from '../lib/historyStore'

export const healthRoute = new Elysia({ prefix: '/health' })
  // Shallow — used by Render health check probe
  // Must always return 200 quickly
  .get('/', () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))
  // Deep — used by monitoring and the frontend status badge
  .get('/deep', async ({ set }) => {
    // Check the history store (Postgres) — the app's only durable dependency
    let dbOk = false
    let dbLatency = 0
    try {
      const t = Date.now()
      await withHistoryStore(async (db) => {
        await db`select 1`
      })
      dbOk = true
      dbLatency = Date.now() - t
    } catch (err) {
      console.warn(
        JSON.stringify({
          type: 'health_check_degraded',
          component: 'database',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
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
      console.warn(
        JSON.stringify({
          type: 'health_check_degraded',
          component: 'engine',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
    }

    // Check queue depth (observer — no raw queue handle needed)
    let waiting = 0
    let failed = 0
    try {
      const stats = await getAnalysisQueueStats()
      waiting = stats.waiting
      failed = stats.failed
    } catch (err) {
      console.warn(
        JSON.stringify({
          type: 'health_check_degraded',
          component: 'queue',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
    }

    const status = !dbOk
      ? 'unhealthy'
      : !engineOk
        ? 'degraded'
        : failed > 10
          ? 'degraded'
          : 'healthy'

    set.status = status === 'unhealthy' ? 503 : 200

    return {
      status,
      checks: {
        database: { ok: dbOk, latency_ms: dbLatency },
        engine: { ok: engineOk, latency_ms: engineLatency },
        queue: { ok: true, waiting, failed },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })
