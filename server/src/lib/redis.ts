import IORedis from "ioredis"

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const isLocalRedis = REST_URL.includes("localhost") || REST_URL.includes("127.0.0.1")

function createRedisClient() {
  if (isLocalRedis) {
    const ioRedisUrl = process.env.UPSTASH_REDIS_IOREDIS_URL || "redis://localhost:6379"
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
    }
  } else {
    // Upstash REST — lazy import to avoid crash when env vars are missing
    try {
      const { Redis } = require("@upstash/redis")
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
    } catch {
      console.error(JSON.stringify({ type: "redis_fallback_noop", message: "@upstash/redis module not available, using noop client" }))
      return {
        async get() { return null },
        async set() {},
        async ping() { return "PONG" },
        async del() { return 0 },
      }
    }
  }
}

export const redis = createRedisClient()
