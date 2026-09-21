import type { Redis as IORedis } from "ioredis"

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const isLocalRedis = REST_URL.includes("localhost") || REST_URL.includes("127.0.0.1")

// Derive a Redis protocol URL from the Upstash REST URL and token.
// REST URL format: https://<endpoint>.upstash.io
// Redis protocol format: rediss://default:<token>@<endpoint>.upstash.io:6379
function getRedisConnectionUrl(): string | null {
  if (!REST_URL) return null
  if (isLocalRedis) return process.env.UPSTASH_REDIS_IOREDIS_URL || "redis://localhost:6379"
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!token) return null
  try {
    const host = new URL(REST_URL).host // e.g., "neutral-urchin-104723.upstash.io"
    return `rediss://default:${token}@${host}:6379`
  } catch {
    return null
  }
}

function createRedisClient() {
  const url = getRedisConnectionUrl()
  if (!url) {
    console.error(
      JSON.stringify({ type: "redis_unavailable", message: "UPSTASH_REDIS_REST_URL unset, using noop client" })
    )
    return createNoopClient()
  }

  try {
    const IORedis = require("ioredis") as typeof import("ioredis").default
    const client: IORedis = new IORedis(url, {
      maxRetriesPerRequest: null,
      commandTimeout: 5000,
      connectTimeout: 5000,
      ...(isLocalRedis ? {} : { tls: {}, lazyConnect: false }),
    })
    client.on("error", (err: Error) => {
      console.error(JSON.stringify({ type: "redis_error", source: "redis", message: err.message }))
    })
    client.on("reconnecting", (delay: number) => {
      console.warn(JSON.stringify({ type: "redis_reconnecting", source: "redis", delay_ms: delay }))
    })

    return {
      async get(key: string) {
        const val = await client.get(key)
        if (!val) return null
        try {
          return JSON.parse(val)
        } catch {
          return val
        }
      },
      async set(key: string, value: string | number | Record<string, unknown>, opts?: { ex?: number }) {
        const str = typeof value === "string" ? value : JSON.stringify(value)
        if (opts?.ex) {
          await client.setex(key, opts.ex, str)
        } else {
          await client.set(key, str)
        }
      },
      async ping() {
        return await client.ping()
      },
      async del(key: string) {
        return await client.del(key)
      },
      async rateLimitIncrement(key: string, limit: number, windowSec: number) {
        const now = Math.floor(Date.now() / 1000)
        const resetAt = now + windowSec

        const current = await client.incr(key)
        if (current === 1) {
          await client.expire(key, windowSec)
          return { allowed: true, current: 1, reset: resetAt * 1000 }
        } else if (current > limit) {
          const ttl = await client.ttl(key)
          return { allowed: false, current, reset: (now + ttl) * 1000 }
        } else {
          const ttl = await client.ttl(key)
          return { allowed: true, current, reset: (now + ttl) * 1000 }
        }
      },
      async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<number> {
        try {
          const result = await client.eval(script, numKeys, ...args)
          return typeof result === "number" ? result : parseInt(String(result), 10) || 0
        } catch {
          return 0
        }
      },
    }
  } catch {
    console.error(JSON.stringify({ type: "redis_unavailable", message: "ioredis module not available, using noop client" }))
    return createNoopClient()
  }
}

function createNoopClient() {
  return {
    async get() {
      return null
    },
    async set() {},
    async ping() {
      return "PONG"
    },
    async del() {
      return 0
    },
    async rateLimitIncrement() {
      return { allowed: true, current: 0, reset: Date.now() }
    },
    async eval(_script: string, _numKeys: number, ..._args: (string | number)[]): Promise<number> {
      return 0
    },
  }
}

export const redis = createRedisClient()