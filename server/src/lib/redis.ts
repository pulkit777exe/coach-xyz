const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const isLocalRedis = REST_URL.includes("localhost") || REST_URL.includes("127.0.0.1")

function createRedisClient() {
  if (isLocalRedis) {
    // Lazy import ioredis for local development only
    try {
      const IORedis = require("ioredis")
      const ioRedisUrl = process.env.UPSTASH_REDIS_REST_URL || "redis://localhost:6379"
      const ioredis = new IORedis(ioRedisUrl, { maxRetriesPerRequest: null })
      return {
        async get(key: string) {
          const val = await ioredis.get(key)
          if (!val) return null
          try { return JSON.parse(val) } catch { return val }
        },
        async set(key: string, value: any, opts?: { ex?: number }) {
          const str = typeof value === "string" ? value : JSON.stringify(value)
          if (opts?.ex) {
            await ioredis.setex(key, opts.ex, str)
          } else {
            await ioredis.set(key, str)
          }
        },
        async ping() {
          return await ioredis.ping()
        },
        async del(key: string) {
          return await ioredis.del(key)
        },
        async rateLimitIncrement(key: string, limit: number, windowSec: number) {
          const now = Math.floor(Date.now() / 1000)
          const resetAt = now + windowSec

          const current = await ioredis.incr(key)
          if (current === 1) {
            await ioredis.expire(key, windowSec)
            return { allowed: true, current: 1, reset: resetAt * 1000 }
          } else if (current > limit) {
            const ttl = await ioredis.ttl(key)
            return { allowed: false, current, reset: (now + ttl) * 1000 }
          } else {
            const ttl = await ioredis.ttl(key)
            return { allowed: true, current, reset: (now + ttl) * 1000 }
          }
        },
      }
    } catch {
      console.error(JSON.stringify({ type: "redis_fallback_noop", message: "ioredis not available for local Redis, using noop client" }))
      return createNoopClient()
    }
  } else {
    // Upstash REST API
    try {
      const { Redis } = require("@upstash/redis")
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
    } catch {
      console.error(JSON.stringify({ type: "redis_fallback_noop", message: "@upstash/redis module not available, using noop client" }))
      return createNoopClient()
    }
  }
}

function createNoopClient() {
  return {
    async get() { return null },
    async set() {},
    async ping() { return "PONG" },
    async del() { return 0 },
    async rateLimitIncrement() { return { allowed: true, current: 0, reset: Date.now() } },
  }
}

export const redis = createRedisClient()
