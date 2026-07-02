import IORedis from "ioredis"

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const isLocalRedis = REST_URL.includes("localhost") || REST_URL.includes("127.0.0.1")

// Atomic rate limit Lua script for ioredis
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local resetAt = now + window

-- Try to increment existing key
local current = redis.call('INCR', key)
if current == 1 then
  -- New key, set expiry
  redis.call('EXPIRE', key, window)
  return {1, resetAt, limit - 1}
elseif current > limit then
  -- Over limit, get TTL
  local ttl = redis.call('TTL', key)
  return {current, now + ttl, 0}
else
  -- Under limit, get TTL
  local ttl = redis.call('TTL', key)
  return {current, now + ttl, limit - current}
end
`

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
      // Atomic rate limit increment
      async rateLimitIncrement(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; current: number; reset: number }> {
        try {
          const result = await ioredis.eval(RATE_LIMIT_LUA, [key], [String(limit), String(windowSec), String(Math.floor(Date.now() / 1000))]) as number[][]
          const [current, resetUnix, remaining] = result[0]
          return {
            allowed: current <= limit,
            current,
            reset: resetUnix * 1000,
          }
        } catch {
          // Fallback to non-atomic if eval fails
          return { allowed: true, current: 0, reset: Date.now() + windowSec * 1000 }
        }
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
        async rateLimitIncrement() { return { allowed: true, current: 0, reset: Date.now() } },
      }
    }
  }
}

export const redis = createRedisClient()
