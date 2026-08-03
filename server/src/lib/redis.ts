const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const isLocalRedis = REST_URL.includes("localhost") || REST_URL.includes("127.0.0.1")

function createRedisClient() {
  if (isLocalRedis) {
    // Lazy import ioredis for local development only
    try {
      const IORedis = require("ioredis")
      const ioRedisUrl = process.env.UPSTASH_REDIS_REST_URL || "redis://localhost:6379"
      const ioredis = new IORedis(ioRedisUrl, {
        maxRetriesPerRequest: null,
        commandTimeout: 5000,
        connectTimeout: 5000,
      })
      ioredis.on("error", (err: Error) => {
        console.error(JSON.stringify({ type: "redis_error", source: "ratelimit", message: err.message }))
      })
      ioredis.on("reconnecting", (delay: number) => {
        console.warn(JSON.stringify({ type: "redis_reconnecting", source: "ratelimit", delay_ms: delay }))
      })
      return {
        async get(key: string) {
          const val = await ioredis.get(key)
          if (!val) return null
          try { return JSON.parse(val) } catch { return val }
        },
        async set(key: string, value: string | number | Record<string, unknown>, opts?: { ex?: number }) {
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
        async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<number> {
          try {
            const result = await ioredis.eval(script, numKeys, ...args)
            return typeof result === "number" ? result : parseInt(String(result), 10) || 0
          } catch {
            return 0
          }
        },
        async incr(key: string): Promise<number> {
          try {
            return await ioredis.incr(key)
          } catch {
            return 1
          }
        },
        async expire(key: string, seconds: number): Promise<number> {
          try {
            return await ioredis.expire(key, seconds)
          } catch {
            return 1
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
    async eval(_script: string, _numKeys: number, ..._args: (string | number)[]): Promise<number> {
      return 0
    },
    async incr(_key: string): Promise<number> {
      return 1
    },
    async expire(_key: string, _seconds: number): Promise<number> {
      return 1
    },
  }
}

export const redis = createRedisClient()
