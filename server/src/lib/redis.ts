import type { Redis as IORedis } from 'ioredis'

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || ''
const isLocalRedis = REST_URL.includes('localhost') || REST_URL.includes('127.0.0.1')

// Derive a Redis protocol URL from the Upstash REST URL and token.
// REST URL format: https://<endpoint>.upstash.io
// Redis protocol format: rediss://default:<token>@<endpoint>.upstash.io:6379
function getRedisConnectionUrl(): string | null {
  // Prioritize explicit local Redis URL if configured (e.g., docker Redis container)
  // This prevents reconnect loops against unreachable Upstash Redis REST
  const explicitLocalUrl = process.env.UPSTASH_REDIS_IOREDIS_URL
  if (explicitLocalUrl) return explicitLocalUrl

  // Fall back to original logic: derive from Upstash REST URL and token
  if (!REST_URL) return null
  if (isLocalRedis) return process.env.UPSTASH_REDIS_IOREDIS_URL || 'redis://localhost:6379'
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!token) return null
  try {
    const host = new URL(REST_URL).host // e.g., "neutral-urchin-104723.upstash.io"
    return `rediss://default:${token}@${host}:6379`
  } catch {
    return null
  }
}

let _rawClient: IORedis | null = null
let _rawClientError: Error | null = null

export function getRawRedisClient(): IORedis | null {
  if (_rawClient) return _rawClient
  if (_rawClientError) return null

  const url = getRedisConnectionUrl()
  if (!url) {
    console.error(
      JSON.stringify({
        type: 'redis_unavailable',
        message: 'UPSTASH_REDIS_REST_URL unset, using noop client',
      }),
    )
    return null
  }

  try {
    const IORedis = require('ioredis') as typeof import('ioredis').default
    // TLS: false = plain TCP for non-TLS URLs (redis://); TLS enabled only for rediss://
    _rawClient = new IORedis(url, {
      maxRetriesPerRequest: null,
      commandTimeout: 10000,
      connectTimeout: 10000,
      tls: url.startsWith('rediss://') ? {} : false,
      lazyConnect: false,
    })
    _rawClient.on('error', (err: Error) => {
      console.error(
        JSON.stringify({
          type: 'redis_error',
          source: 'redis',
          message: err.message,
        }),
      )
    })
    _rawClient.on('reconnecting', (delay: number) => {
      console.warn(
        JSON.stringify({
          type: 'redis_reconnecting',
          source: 'redis',
          delay_ms: delay,
        }),
      )
    })
    return _rawClient
  } catch (err) {
    _rawClientError = err as Error
    console.error(
      JSON.stringify({
        type: 'redis_unavailable',
        message: 'ioredis module not available, using noop client',
        error: (err as Error).message,
      }),
    )
    return null
  }
}

function createRedisClient() {
  const client = getRawRedisClient()
  if (!client) {
    return createNoopClient()
  }

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
    async set(
      key: string,
      value: string | number | Record<string, unknown>,
      opts?: { ex?: number },
    ) {
      const str = typeof value === 'string' ? value : JSON.stringify(value)
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
        return typeof result === 'number' ? result : parseInt(String(result), 10) || 0
      } catch {
        return 0
      }
    },
  }
}

function createNoopClient() {
  return {
    async get() {
      return null
    },
    async set() {},
    async ping() {
      return 'PONG'
    },
    async del() {
      return 0
    },
    async rateLimitIncrement(): Promise<never> {
      throw new Error('redis_unavailable')
    },
    async eval(_script: string, _numKeys: number, ..._args: (string | number)[]): Promise<number> {
      return 0
    },
  }
}

export const redis = createRedisClient()
