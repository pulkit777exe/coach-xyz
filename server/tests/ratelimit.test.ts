import { afterEach, describe, expect, test } from 'bun:test'

import { __setRedisForTests, checkLimit } from '../src/lib/ratelimit'

afterEach(() => {
  __setRedisForTests(null)
})

describe('checkLimit without Redis', () => {
  test('fails over to the in-memory limiter instead of allowing everything', async () => {
    // Noop client behavior (see src/lib/redis.ts): no Redis behind us, so
    // the increment throws and checkLimit must use the memory limiter.
    __setRedisForTests({
      rateLimitIncrement: async () => {
        throw new Error('redis_unavailable')
      },
    })

    const key = `test:failover:${Date.now()}`
    // Limit 2 per hour: first two pass, third is rejected.
    expect((await checkLimit({ key, limit: 2, windowSec: 3600 })).allowed).toBe(true)
    expect((await checkLimit({ key, limit: 2, windowSec: 3600 })).allowed).toBe(true)
    const rejected = await checkLimit({ key, limit: 2, windowSec: 3600 })
    expect(rejected.allowed).toBe(false)
    expect(rejected.remaining).toBe(0)
  })
})

describe('checkScanProgressLimit', () => {
  test('is keyed on the session token, not the client IP', async () => {
    const { checkScanProgressLimit } = await import('../src/lib/ratelimit')
    __setRedisForTests({
      rateLimitIncrement: async () => {
        throw new Error('redis_unavailable')
      },
    })
    try {
      // Default 30/min: flood one session, a sibling session is unaffected.
      const victim = `test:session:${Date.now()}-a`
      const sibling = `test:session:${Date.now()}-b`
      for (let i = 0; i < 30; i++) {
        expect((await checkScanProgressLimit(victim)).allowed).toBe(true)
      }
      expect((await checkScanProgressLimit(victim)).allowed).toBe(false)
      expect((await checkScanProgressLimit(sibling)).allowed).toBe(true)
    } finally {
      __setRedisForTests(null)
    }
  })
})
