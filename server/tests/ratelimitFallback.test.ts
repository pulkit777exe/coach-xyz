import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Elysia } from 'elysia'

// ── ratelimit.ts: the fail-open path, and the rejection envelope ─────────────
//
// The uncovered half of this module is exactly the part AGENTS.md calls out as
// "read-verified but not runtime-pinned": when Redis is unavailable `checkLimit`
// fails OPEN to a per-process in-memory limiter and logs
// `rate_limit_degraded_to_memory`. The fallback is per-process AND per-replica,
// so a Redis outage quietly weakens the limit for every user while looking
// perfectly healthy — and it bites hardest exactly when the shared serverless
// quota is spent, which is when *every* request takes this path.
//
// Four things are pinned here:
//   • the fallback still refuses once the budget is spent (fail-open must mean
//     "degraded", not "unlimited"),
//   • the degradation is LOGGED with the key and the error (fail-open stays
//     observable — the assertion reads the logger, which is what makes it
//     runtime-pinned rather than read-verified),
//   • every `check*Limit` helper's key shape and default, so two callers cannot
//     silently share a bucket,
//   • the `rateLimited` envelope: 429, a retryable RATE_LIMITED, and a
//     `retry_after` that is never 0.
//
// `lib/redis` connects on import, so it is stubbed; the logger is stubbed too so
// the eviction case can drive 10k+ iterations without 10k lines of output, and so
// the warn can be ASSERTED. Both stubs are registered before the dynamic import
// below (a static import binds the real module first and the mock then applies to
// nothing). `--isolate` keeps the registry private to this file.

type LogLine = { level: string; event: string; meta: Record<string, unknown> }

const logs: LogLine[] = []

const makeLogger = () => ({
  debug: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'debug', event, meta: meta ?? {} }),
  info: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'info', event, meta: meta ?? {} }),
  warn: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'warn', event, meta: meta ?? {} }),
  error: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'error', event, meta: meta ?? {} }),
})

mock.module('../src/lib/logger', () => ({ logger: makeLogger(), createLogger: makeLogger }))

type IncrResult = { allowed: boolean; current: number; reset: number }
let incr: (key: string, limit: number, windowSec: number) => Promise<IncrResult>
const seenKeys: { key: string; limit: number; windowSec: number }[] = []

const setIncr = (fn: (key: string, limit: number, windowSec: number) => Promise<IncrResult>) => {
  incr = fn
}

const redisStub = {
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    async get() {
      return null
    },
    async set() {},
    async del() {
      return 0
    },
    async ping() {
      return 'PONG'
    },
    async rateLimitIncrement(key: string, limit: number, windowSec: number) {
      seenKeys.push({ key, limit, windowSec })
      return incr(key, limit, windowSec)
    },
    async eval() {
      return 0
    },
  },
}

mock.module('../src/lib/redis', () => redisStub)

const rl = await import('../src/lib/ratelimit')

const DEFAULTED = {
  SCAN_RATE_LIMIT: undefined,
  ANALYSIS_RATE_LIMIT: undefined,
  CHAT_RATE_LIMIT: undefined,
  DOWNLOAD_RATE_LIMIT: undefined,
  SCAN_PROGRESS_RATE_LIMIT: undefined,
  EMAIL_RATE_LIMIT: undefined,
  AI_REPORT_RATE_LIMIT: undefined,
  STATUS_RATE_LIMIT: undefined,
  CLIP_RATE_LIMIT: undefined,
  ORG_WRITE_RATE_LIMIT: undefined,
} as Record<string, string | undefined>

beforeEach(() => {
  logs.length = 0
  seenKeys.length = 0
  for (const k of Object.keys(DEFAULTED)) delete process.env[k]
  setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
})

afterEach(() => {
  for (const k of Object.keys(DEFAULTED)) delete process.env[k]
})

describe('checkLimit over Redis', () => {
  test('an allowed increment reports the remaining budget and the server reset', async () => {
    const reset = Date.now() + 3_600_000
    setIncr(async () => ({ allowed: true, current: 2, reset }))
    expect(await rl.checkLimit({ key: 'k', limit: 5, windowSec: 3600 })).toEqual({
      allowed: true,
      remaining: 3,
      reset,
    })
    expect(seenKeys).toEqual([{ key: 'k', limit: 5, windowSec: 3600 }])
    expect(logs.filter((l) => l.event === 'rate_limit_degraded_to_memory')).toEqual([])
  })

  test('a refused increment reports remaining 0, never a negative count', async () => {
    setIncr(async () => ({ allowed: false, current: 99, reset: Date.now() + 1000 }))
    // `Math.max(0, limit - current)` — a negative `remaining` would be read by
    // any caller that surfaces it as "N attempts left".
    expect((await rl.checkLimit({ key: 'k', limit: 5, windowSec: 60 })).remaining).toBe(0)
  })

  test('a current exactly at the limit is still allowed (the rule is > limit)', async () => {
    setIncr(async () => ({ allowed: true, current: 5, reset: Date.now() + 1000 }))
    const result = await rl.checkLimit({ key: 'k', limit: 5, windowSec: 60 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })
})

describe('checkLimit failing OPEN to the in-memory limiter', () => {
  test('a Redis outage still refuses once the budget is spent', async () => {
    setIncr(async () => {
      throw new Error('max requests limit exceeded')
    })
    // Degraded must not mean unlimited. Three calls at limit 2: two allowed, the
    // third refused with remaining 0.
    const first = await rl.checkLimit({ key: 'degraded', limit: 2, windowSec: 60 })
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(1)
    const second = await rl.checkLimit({ key: 'degraded', limit: 2, windowSec: 60 })
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(0)
    const third = await rl.checkLimit({ key: 'degraded', limit: 2, windowSec: 60 })
    expect(third.allowed).toBe(false)
    expect(third.remaining).toBe(0)
    // And the refusal's reset is the same window, not `now`.
    expect(third.reset).toBe(first.reset)
  })

  test('the degradation is LOGGED, with the key and the error message', async () => {
    // The assertion that makes this read-verified claim runtime-pinned: with the
    // shared quota spent, every request takes this path and nothing else
    // distinguished it from normal operation.
    setIncr(async () => {
      throw new Error('ERR max requests limit exceeded')
    })
    await rl.checkLimit({ key: 'rl:aireport:auth0|org', limit: 10, windowSec: 3600 })
    const warn = logs.find((l) => l.event === 'rate_limit_degraded_to_memory')
    expect(warn).toBeDefined()
    expect(warn!.level).toBe('warn')
    expect(warn!.meta.type).toBe('rate_limit_degraded_to_memory')
    expect(warn!.meta.key).toBe('rl:aireport:auth0|org')
    expect(String(warn!.meta.error)).toContain('max requests limit exceeded')
  })

  test('a non-Error throw is stringified rather than logged as [object Object]', async () => {
    setIncr(async () => {
      // A non-Error rejection is the point: the warn does `String(error)`.
      // eslint-disable-next-line no-throw-literal
      throw 'plain string failure'
    })
    await rl.checkLimit({ key: 'k', limit: 5, windowSec: 60 })
    const warn = logs.find((l) => l.event === 'rate_limit_degraded_to_memory')
    expect(warn!.meta.error).toBe('plain string failure')
  })

  test('the in-memory budget is PER KEY, so two callers cannot share a bucket', async () => {
    setIncr(async () => {
      throw new Error('redis down')
    })
    await rl.checkLimit({ key: 'a', limit: 1, windowSec: 60 })
    expect((await rl.checkLimit({ key: 'a', limit: 1, windowSec: 60 })).allowed).toBe(false)
    expect((await rl.checkLimit({ key: 'b', limit: 1, windowSec: 60 })).allowed).toBe(true)
  })

  test('the in-memory budget EXPIRES and starts a fresh window', async () => {
    setIncr(async () => {
      throw new Error('redis down')
    })
    // windowSec 0.001 → a 1ms window. `evictExpiredMemoryLimits` drops entries
    // whose resetAt has passed, so a stale counter cannot refuse forever.
    expect((await rl.checkLimit({ key: 'expiring', limit: 1, windowSec: 0.001 })).allowed).toBe(true)
    await Bun.sleep(20)
    const after = await rl.checkLimit({ key: 'expiring', limit: 1, windowSec: 0.001 })
    expect(after.allowed).toBe(true)
    expect(after.remaining).toBe(0)
  })

  test('the in-memory store is bounded: it trims rather than growing without limit', async () => {
    setIncr(async () => {
      throw new Error('redis down')
    })
    // MEMORY_LIMIT_MAX_ENTRIES is 10 000 and the trim halves it, so a flood of
    // distinct keys (each one an IP, behind a proxy that never reuses one) must
    // not be able to grow the Map without bound in a long-lived process.
    const before = Bun.nanoseconds()
    for (let i = 0; i < 10_400; i++) {
      await rl.checkLimit({ key: `flood:${i}`, limit: 5, windowSec: 3600 })
    }
    const ms = (Bun.nanoseconds() - before) / 1e6
    // The trim is observable only as "this still works": a key from the first
    // tranche has been evicted, so asking again is a fresh count, not a refusal.
    const reused = await rl.checkLimit({ key: 'flood:0', limit: 5, windowSec: 3600 })
    expect(reused.allowed).toBe(true)
    expect(reused.remaining).toBe(4)
    expect(ms).toBeLessThan(20_000)
  })
})

describe('every limiter helper: key shape and default budget', () => {
  test('the defaults are the documented ones and the keys are namespaced', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: 1 }))
    await rl.checkScanLimit('1.2.3.4')
    await rl.checkAnalysisLimit('1.2.3.4')
    await rl.checkChatLimit('1.2.3.4|auth0|u')
    await rl.checkDownloadLimit('1.2.3.4|auth0|u')
    await rl.checkScanProgressLimit('1.2.3.4')
    await rl.checkEmailLimit('auth0|org')
    await rl.checkAiReportLimit('auth0|org')
    await rl.checkStatusLimit('1.2.3.4|auth0|u')
    await rl.checkClipLimit('1.2.3.4|auth0|u')
    await rl.checkOrgWriteLimit('auth0|u')
    expect(seenKeys).toEqual([
      { key: 'rl:scan:1.2.3.4', limit: 10, windowSec: 60 },
      { key: 'rl:analysis:1.2.3.4', limit: 5, windowSec: 3600 },
      { key: 'rl:chat:1.2.3.4|auth0|u', limit: 30, windowSec: 3600 },
      { key: 'rl:download:1.2.3.4|auth0|u', limit: 60, windowSec: 3600 },
      { key: 'rl:scanprogress:1.2.3.4', limit: 30, windowSec: 60 },
      { key: 'rl:email:auth0|org', limit: 20, windowSec: 86400 },
      { key: 'rl:aireport:auth0|org', limit: 10, windowSec: 3600 },
      { key: 'rl:status:1.2.3.4|auth0|u', limit: 60, windowSec: 60 },
      { key: 'rl:clip:1.2.3.4|auth0|u', limit: 60, windowSec: 3600 },
      { key: 'rl:orgwrite:auth0|u', limit: 120, windowSec: 60 },
    ])
  })

  test('each env override is read per call, so a config change takes effect', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: 1 }))
    process.env.SCAN_RATE_LIMIT = '3'
    process.env.ANALYSIS_RATE_LIMIT = '2'
    process.env.CHAT_RATE_LIMIT = '4'
    process.env.DOWNLOAD_RATE_LIMIT = '6'
    process.env.SCAN_PROGRESS_RATE_LIMIT = '7'
    process.env.EMAIL_RATE_LIMIT = '8'
    process.env.AI_REPORT_RATE_LIMIT = '9'
    process.env.STATUS_RATE_LIMIT = '11'
    process.env.CLIP_RATE_LIMIT = '12'
    process.env.ORG_WRITE_RATE_LIMIT = '13'
    await rl.checkScanLimit('ip')
    await rl.checkAnalysisLimit('ip')
    await rl.checkChatLimit('ip')
    await rl.checkDownloadLimit('ip')
    await rl.checkScanProgressLimit('ip')
    await rl.checkEmailLimit('org')
    await rl.checkAiReportLimit('org')
    await rl.checkStatusLimit('ip')
    await rl.checkClipLimit('ip')
    await rl.checkOrgWriteLimit('ip')
    expect(seenKeys.map((s) => s.limit)).toEqual([3, 2, 4, 6, 7, 8, 9, 11, 12, 13])
  })
})

describe('getIP', () => {
  const withHeaders = (headers: Record<string, string>): Request =>
    new Request('http://localhost/api/org/x', { headers })

  test('reads the RIGHT-most x-forwarded-for entry (the real client behind an appending proxy)', () => {
    expect(rl.getIP(withHeaders({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }))).toBe('3.3.3.3')
    expect(rl.getIP(withHeaders({ 'x-forwarded-for': '  4.4.4.4  ' }))).toBe('4.4.4.4')
  })

  test('falls back to x-real-ip, and to "anonymous" when neither is present', () => {
    expect(rl.getIP(withHeaders({ 'x-real-ip': '5.5.5.5' }))).toBe('5.5.5.5')
    expect(rl.getIP(withHeaders({}))).toBe('anonymous')
    // A blank header is not an IP.
    expect(rl.getIP(withHeaders({ 'x-forwarded-for': '   ' }))).toBe('anonymous')
  })
})

describe('rateLimited: the one rejection envelope', () => {
  test('sets 429 and builds a retryable RATE_LIMITED server error', () => {
    const set: { status?: number | string } = {}
    const body = rl.rateLimited(set, 'Too many changes. Wait a minute before trying again.', 42)
    expect(set.status).toBe(429)
    expect(body.code).toBe('RATE_LIMITED')
    expect(body.layer).toBe('server')
    expect(body.retryable).toBe(true)
    expect(body.message).toBe('Too many changes. Wait a minute before trying again.')
    expect(body.retry_after).toBe(42)
  })

  test('retry_after is omitted entirely when the limiter has no reset', () => {
    const body = rl.rateLimited({}, 'nope')
    expect('retry_after' in body).toBe(false)
  })

  test('retry_after is floored at 1 — never 0, never negative', () => {
    // A past reset must not tell a client to retry immediately; that is how a
    // rate limit turns into a hot loop.
    expect(rl.rateLimited({}, 'x', 0).retry_after).toBe(1)
    expect(rl.rateLimited({}, 'x', -30).retry_after).toBe(1)
    expect(rl.rateLimited({}, 'x', 0.2).retry_after).toBe(1)
    expect(rl.rateLimited({}, 'x', 1.2).retry_after).toBe(2)
  })
})

describe('orgWriteRateLimit: the global write-method hook', () => {
  // Elysia's `.handle` always answers with a Response, so the pass-through cases
  // assert on the body it hands back rather than on a returned string.
  const bodyOf = async (res: unknown): Promise<string> =>
    res instanceof Response ? await res.text() : String(res)

  const post = async (path: string, headers: Record<string, string> = {}) =>
    bodyOf(
      await new Elysia()
        .use(rl.orgWriteRateLimit)
        .post(path, () => 'handler ran')
        .get(path, () => 'handler ran')
        .handle(new Request(`http://localhost${path}`, { method: 'POST', headers })),
    )

  const read = async (path: string) =>
    bodyOf(
      await new Elysia()
        .use(rl.orgWriteRateLimit)
        .get(path, () => 'handler ran')
        .handle(new Request(`http://localhost${path}`)),
    )

  test('a write on an identity tree consumes budget and passes through', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
    for (const path of ['/api/org/attendance', '/api/email/invite', '/api/auth/user/x']) {
      seenKeys.length = 0
      expect(await post(path, { 'x-verified-auth0-id': 'auth0|u' })).toBe('handler ran')
      expect(seenKeys[0]!.key).toBe('rl:orgwrite:auth0|u')
    }
  })

  test('a READ on the same tree never consumes budget', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
    expect(await read('/api/org/attendance')).toBe('handler ran')
    expect(seenKeys).toEqual([])
  })

  test('a write OUTSIDE the three identity trees is untouched', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
    expect(await post('/api/analyze')).toBe('handler ran')
    expect(seenKeys).toEqual([])
  })

  test('an unverified write falls back to the client IP as its key', async () => {
    setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
    await post('/api/org/settings', { 'x-forwarded-for': '9.9.9.9' })
    expect(seenKeys[0]!.key).toBe('rl:orgwrite:9.9.9.9')
  })

  test('an over-budget write is refused with the shared 429 envelope and a real retry_after', async () => {
    setIncr(async () => ({ allowed: false, current: 500, reset: Date.now() + 30_000 }))
    const res = await new Elysia()
      .use(rl.orgWriteRateLimit)
      .post('/api/org/settings', () => 'handler ran')
      .handle(new Request('http://localhost/api/org/settings', {
        method: 'POST',
        headers: { 'x-verified-auth0-id': 'auth0|u' },
      }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { code: string; retry_after: number }
    expect(body.code).toBe('RATE_LIMITED')
    expect(body.retry_after).toBeGreaterThan(0)
    expect(body.retry_after).toBeLessThanOrEqual(30)
  })

  test('an over-budget write whose reset has already passed still says retry in 1s', async () => {
    setIncr(async () => ({ allowed: false, current: 500, reset: Date.now() - 5_000 }))
    const res = await new Elysia()
      .use(rl.orgWriteRateLimit)
      .post('/api/org/settings', () => 'handler ran')
      .handle(new Request('http://localhost/api/org/settings', {
        method: 'POST',
        headers: { 'x-verified-auth0-id': 'auth0|u' },
      }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { retry_after: number }
    expect(body.retry_after).toBe(1)
  })

  test('the hook tolerates a request whose URL cannot be parsed', async () => {
    // `new URL(request.url)` can throw on a malformed request target; the guard
    // returns rather than 500-ing every write that reaches it. Registered as a
    // catch-all so Elysia's own router — which reads the same `url` — still
    // matches after the property is replaced.
    setIncr(async () => ({ allowed: true, current: 1, reset: Date.now() + 60_000 }))
    const req = new Request('http://localhost/api/org/settings', { method: 'POST' })
    Object.defineProperty(req, 'url', { value: 'not a url' })
    const res = await new Elysia()
      .use(rl.orgWriteRateLimit)
      .post('/*', () => 'handler ran')
      .handle(req)
    expect(await bodyOf(res)).toBe('handler ran')
    expect(seenKeys).toEqual([])
  })
})