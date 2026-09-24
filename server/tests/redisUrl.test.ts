import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { getRedisConnectionUrl, isLocalRedis } from '../src/lib/redis'

// ── Redis URL derivation parity pin ─────────────────────────────────────────
// getRedisConnectionUrl is the SINGLE derivation (redis.ts exports it,
// queue.ts consumes it). Before unification, queue.ts built its own URL and
// unconditionally embedded `rediss://default:<token>@<host>:6379` with TLS —
// so the localhost case below would have resolved to
// `rediss://default:<token>@localhost:6379` (TLS) instead of plain
// `redis://localhost:6379`. That divergence is exactly what this file pins.

const ENV_KEYS = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_IOREDIS_URL',
] as const

const originalEnv: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) originalEnv[key] = process.env[key]

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (!(key in values)) continue
    const value = values[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('getRedisConnectionUrl (the one URL derivation)', () => {
  test('localhost Upstash-style env → redis:// on 6379, no TLS', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'http://localhost:8080',
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_REDIS_IOREDIS_URL: undefined,
    })
    // Plain scheme — callers gate `tls: {}` on this, so localhost never gets TLS.
    expect(getRedisConnectionUrl()).toBe('redis://localhost:6379')
    expect(isLocalRedis()).toBe(true)
  })

  test('127.0.0.1 Upstash-style env → redis:// on 6379, no TLS', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'https://127.0.0.1:8080',
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_REDIS_IOREDIS_URL: undefined,
    })
    expect(getRedisConnectionUrl()).toBe('redis://localhost:6379')
    expect(isLocalRedis()).toBe(true)
  })

  test('localhost with an explicit IOREDIS URL → passthrough', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'http://localhost:8080',
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_REDIS_IOREDIS_URL: 'redis://redis:6379/2',
    })
    expect(getRedisConnectionUrl()).toBe('redis://redis:6379/2')
    expect(isLocalRedis()).toBe(true)
  })

  test('real Upstash env → rediss:// with embedded token, TLS on', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'https://neutral-urchin-104723.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok-123',
      UPSTASH_REDIS_IOREDIS_URL: undefined,
    })
    expect(getRedisConnectionUrl()).toBe(
      'rediss://default:tok-123@neutral-urchin-104723.upstash.io:6379',
    )
    expect(isLocalRedis()).toBe(false)
  })

  test('missing REST URL → null (documented fallback: noop/disabled client)', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    })
    expect(getRedisConnectionUrl()).toBeNull()
  })

  test('Upstash URL without token → null (no derivation without credentials)', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'https://neutral-urchin-104723.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: undefined,
    })
    expect(getRedisConnectionUrl()).toBeNull()
  })

  test('malformed REST URL → null', () => {
    setEnv({
      UPSTASH_REDIS_REST_URL: 'not a url',
      UPSTASH_REDIS_REST_TOKEN: 'tok-123',
    })
    expect(getRedisConnectionUrl()).toBeNull()
  })
})

describe('single-derivation seam (source structure)', () => {
  test('queue.ts consumes getRedisConnectionUrl and constructs no URL itself', () => {
    const queueSrc = readFileSync(join(import.meta.dir, '../src/lib/queue.ts'), 'utf8')
    expect(queueSrc).toContain('getRedisConnectionUrl')
    // The literal rediss://…@host construction must exist in exactly one module.
    expect(queueSrc).not.toContain('rediss://')
    expect(queueSrc).not.toContain('new URL(')
  })
})
