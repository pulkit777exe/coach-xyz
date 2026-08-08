import { Elysia } from "elysia"
import { ENGINE_URL } from "../lib/engine"
import { analysisQueue } from "../lib/queue"
import { redis } from "../lib/redis"
import { serviceAll, serviceIsHealthy } from "../lib/serviceRegistry"

export const healthRoute = new Elysia({ prefix: "/health" })
  .get("/", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))
  .get("/deep", async ({ set }) => {
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

    let waiting = 0
    let failed = 0
    let queueOk = false
    try {
      if (analysisQueue) {
        waiting = await analysisQueue.getWaitingCount()
        failed = await analysisQueue.getFailedCount()
        queueOk = true
      }
    } catch (err) {
      console.warn(JSON.stringify({ type: "health_check_degraded", component: "queue", error: err instanceof Error ? err.message : "unknown" }))
    }

    const services = serviceAll()
    const registryHealthy = serviceIsHealthy()

    const status =
      !redisOk || !registryHealthy
        ? "unhealthy"
        : !engineOk || failed > 10
          ? "degraded"
          : "healthy"

    set.status = status === "unhealthy" ? 503 : 200

    return {
      status,
      checks: {
        redis: { ok: redisOk, latency_ms: redisLatency },
        engine: { ok: engineOk, latency_ms: engineLatency },
        queue: { ok: queueOk, waiting, failed },
      },
      services,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })
