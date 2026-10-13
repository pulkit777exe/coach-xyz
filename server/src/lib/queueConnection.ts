// ── Queue connection builder (single home) ───────────────────────────────────
// One builder for BullMQ-grade IORedis clients (30s timeouts, lazy connect,
// TLS): previously forked between workerLifecycle.getRedisConnection and the
// notifications QueueEvents setup ("replicates the Redis connection setup").
// The REST-fallback wrapper in ./redis.ts is a different shape (5s timeouts,
// eager connect, localhost branch, noop fallback) and stays separate.
// Returns null without Upstash env; require-failures propagate to the
// caller's existing catch (both call sites already degrade to disabled).

import type { Redis } from 'ioredis'

export const buildQueueConnection = (source: string): Redis | null => {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!restUrl || !token) return null

  // Derive Redis protocol URL from Upstash REST URL and token
  // REST URL format: https://<endpoint>.upstash.io
  // Redis protocol format: rediss://default:<token>@<endpoint>.upstash.io:6379
  const host = new URL(restUrl).host
  const redisUrl = `rediss://default:${token}@${host}:6379`

  const IORedis = require('ioredis') as typeof import('ioredis').default
  const client: Redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    tls: {},
    // Upstash recommended settings for serverless
    enableReadyCheck: false,
    lazyConnect: true,
    commandTimeout: 30000,
    connectTimeout: 30000,
    retryStrategy(times: number) {
      if (times > 10) return null
      return Math.min(times * 500, 5000)
    },
  })
  client.on('error', (err: Error) => {
    console.error(
      JSON.stringify({
        type: 'redis_error',
        source,
        message: err.message,
      }),
    )
  })
  client.on('reconnecting', (delay: number) => {
    console.warn(
      JSON.stringify({
        type: 'redis_reconnecting',
        source,
        delay_ms: delay,
      }),
    )
  })
  return client
}
