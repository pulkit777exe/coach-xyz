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
