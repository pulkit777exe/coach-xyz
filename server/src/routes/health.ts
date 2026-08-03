import { Elysia } from "elysia"
import { ENGINE_URL } from "../lib/engine"
import { analysisQueue } from "../lib/queue"
import { redis } from "../lib/redis"

export const healthRoute = new Elysia({ prefix: "/health" })
  // Shallow — used by Render health check probe
  // Must always return 200 quickly
  .get("/", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))
  // Deep — used by monitoring and the frontend status badge
  .get("/deep", async ({ set }) => {
    // Check Redis
    let redisOk = false
    let redisLatency = 0
    try {
      const t = Date.now()
      await Promise.race([
        redis.ping(),
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 2000)),
      ])
      redisOk = true
      redisLatency = Date.now() - t
    } catch (err) {
      console.warn(JSON.stringify({ type: "health_check_degraded", component: "redis", error: err instanceof Error ? err.message : "unknown" }))
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
      console.warn(JSON.stringify({ type: "health_check_degraded", component: "engine", error: err instanceof Error ? err.message : "unknown" }))
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
      console.warn(JSON.stringify({ type: "health_check_degraded", component: "queue", error: err instanceof Error ? err.message : "unknown" }))
    }

    const status =
      !redisOk
        ? "unhealthy"
        : !engineOk
          ? "degraded"
          : failed > 10
            ? "degraded"
            : "healthy"

    set.status = status === "unhealthy" ? 503 : 200

    return {
      status,
      checks: {
        redis: { ok: redisOk, latency_ms: redisLatency },
        engine: { ok: engineOk, latency_ms: engineLatency },
        queue: { ok: true, waiting, failed },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })
