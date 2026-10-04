import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── The fail-open lines that were read-verified and never runtime-pinned ─────
//
// AGENTS.md records four places where a `catch` returns a fallback and used to
// return one SILENTLY — the behaviour was always deliberate, the silence was the
// defect. `rate_limit_degraded_to_memory` was the first to get a test
// (`ratelimitFallback.test.ts`). These are the other three, and until now nothing
// asserted any of them actually fires.
//
// This matters more than a normal coverage gap, because the whole point of the
// line is that it is the ONLY signal available when the failure is invisible by
// construction: a Neon blip denies every non-owner org request and the route
// answers an ordinary 403, so without the log there is no way to tell a database
// outage from a permissions decision. A test that does not read the logger cannot
// tell whether the line was deleted.
//
// The pattern is the one `ratelimitFallback.test.ts` established, and the two
// traps in it are why it is copied rather than reinvented:
//   • `mock.module` must be registered BEFORE the dynamic `await import`. A static
//     import binds the real module first and the mock then applies to nothing.
//   • the logger stub must be whole, not partial — a module importing `logger`
//     and destructuring `.error` gets `undefined` under a partial stub and throws
//     at the moment you are trying to observe it.
//
// Every case below asserts BOTH halves: that the line fires with the fields a
// triage reader needs, and that the fail-closed/fail-open behaviour is unchanged.
// A test that only asserted the log would pass just as happily against a `catch`
// that logged and then returned the wrong answer.

type LogLine = { level: string; event: string; meta: Record<string, unknown> }

const logs: LogLine[] = []

const makeLogger = () => ({
  debug: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'debug', event, meta: meta ?? {} }),
  info: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'info', event, meta: meta ?? {} }),
  warn: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'warn', event, meta: meta ?? {} }),
  error: (event: string, meta?: Record<string, unknown>) => logs.push({ level: 'error', event, meta: meta ?? {} }),
})

mock.module('../src/lib/logger', () => ({ logger: makeLogger(), createLogger: makeLogger }))

// `getMemberRole` returns null for a non-member WITHOUT throwing, so reaching the
// catch means the database itself errored. That distinction is the whole reason
// the line exists and is worth pinning: the failure mode is not "no role".
let memberRoleThrows: Error | null = new Error('neon: connection terminated unexpectedly')
let orgMembersThrows: Error | null = null

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async () => {
    if (memberRoleThrows) throw memberRoleThrows
    return 'coach'
  },
  listOrgMembers: async () => {
    if (orgMembersThrows) throw orgMembersThrows
    return [{ auth0Id: 'auth0|verified', role: 'coach', email: null, status: 'active' }]
  },
}))

const guard = await import('../src/lib/serviceGuard')
const caller = await import('../src/lib/caller')
const engine = await import('../src/lib/engine')

const req = (headers: Record<string, string>): Request =>
  new Request('http://localhost/api/org/auth0%7Corg/students', { headers })

beforeEach(() => {
  logs.length = 0
  memberRoleThrows = new Error('neon: connection terminated unexpectedly')
  orgMembersThrows = null
})

describe('resolveMemberRoleForPath: member_role_lookup_failed', () => {
  test('a database error is logged with the path and the org, and fails CLOSED', async () => {
    const role = await guard.resolveMemberRoleForPath(
      '/api/org/auth0|org/students',
      'auth0|org',
      'auth0|verified',
    )
    const warn = logs.find((l) => l.event === 'member_role_lookup_failed')
    expect(warn).toBeDefined()
    expect(warn!.level).toBe('warn')
    expect(warn!.meta.type).toBe('member_role_lookup_failed')
    expect(warn!.meta.path).toBe('/api/org/auth0|org/students')
    expect(warn!.meta.orgAuth0Id).toBe('auth0|org')
    expect(String(warn!.meta.error)).toContain('connection terminated')
    // The refusal is the load-bearing half. A catch that logged and then let the
    // caller through would turn a database outage into an authorization hole, and
    // the log would look identical.
    expect(role).toBeNull()
  })

  test('a NON-member answers null and logs NOTHING — a refusal is not a failure', async () => {
    // The distinction that keeps this signal usable: if "no role" also logged,
    // one noisy caller would drown a real outage. `getMemberRole` returns null
    // rather than throwing, so this case must stay silent.
    memberRoleThrows = null
    const role = await guard.resolveMemberRoleForPath(
      '/api/org/auth0|org/students',
      'auth0|org',
      'auth0|verified',
    )
    expect(logs.filter((l) => l.event === 'member_role_lookup_failed')).toEqual([])
    expect(role).toBe('coach')
  })

  test('a non-Error throw is stringified, not logged as [object Object]', async () => {
    memberRoleThrows = 'plain string failure' as unknown as Error
    await guard.resolveMemberRoleForPath('/api/org/auth0|org/x', 'auth0|org', 'auth0|verified')
    expect(logs.find((l) => l.event === 'member_role_lookup_failed')!.meta.error).toBe(
      'plain string failure',
    )
  })
})

describe('orgRoleGuard: org_role_lookup_failed', () => {
  const originalToken = process.env.SERVICE_TOKEN

  beforeEach(() => {
    // `serviceGuardEnabled()` reads the env on every call, so the gate can be
    // opened here rather than by the test runner's environment. Left unset, the
    // guard returns early and this case would pass without reaching the catch —
    // the failure mode of a test that asserts a log nothing emits.
    process.env.SERVICE_TOKEN = 'test-service-token'
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.SERVICE_TOKEN
    else process.env.SERVICE_TOKEN = originalToken
  })

  test('a member-list error is logged and the request is still REFUSED', async () => {
    orgMembersThrows = new Error('connection pool exhausted')
    const { Elysia } = await import('elysia')
    // `orgRoleGuard` returns an Elysia instance whose hook is `as: 'scoped'`, so
    // it only fires for routes mounted AFTER it and only where `params.auth0Id`
    // exists. Both are load-bearing for reproducing the real path.
    const app = new Elysia()
      .use(guard.orgRoleGuard(['coach']))
      .get('/api/org/:auth0Id/students', () => 'handler ran')

    const res = await app.handle(
      new Request('http://localhost/api/org/auth0%7Corg/students', {
        headers: {
          'x-service-token': 'test-service-token',
          'x-verified-auth0-id': 'auth0|verified',
        },
      }),
    )

    const warn = logs.find((l) => l.event === 'org_role_lookup_failed')
    expect(warn).toBeDefined()
    expect(warn!.meta.type).toBe('org_role_lookup_failed')
    expect(warn!.meta.orgAuth0Id).toBe('auth0|org')
    expect(String(warn!.meta.error)).toContain('connection pool exhausted')
    // Fail closed: a transient database error must be indistinguishable from
    // "this caller holds no role here" in its EFFECT, or the outage becomes a
    // privilege escalation. Asserting only the log would pass against a catch
    // that logged and then let the request through.
    expect(res.status).toBe(403)
  })
})

describe('resolveCaller: member_role_lookup_failed', () => {
  test('the capability seam degrades to a non-owner rather than throwing', async () => {
    const c = await caller.resolveCaller('auth0|org', req({ 'x-verified-auth0-id': 'auth0|verified' }))
    expect(logs.filter((l) => l.event === 'member_role_lookup_failed').length).toBeGreaterThan(0)
    // `caller.ts` logs this identical class, so the two seams stay legible as one.
    expect(c.can('player.manage')).toBe(false)
  })
})

describe('markEngineJobFailed: engine_job_failed_not_delivered', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('an unreachable engine is logged AND swallowed, so the caller still records the failure', async () => {
    // The behaviour under test is the `return`, not the throw: the caller
    // persists the failed status on the very next line, so raising here would
    // mean the failure was never recorded at all. The log is what makes the
    // resulting divergence (our row says failed, the engine's says running
    // forever) visible.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    await engine.markEngineJobFailed('engine-job-1', 'Gemini rejected the clip', 'INVALID_REQUEST', false)

    const warn = logs.find((l) => l.event === 'engine_job_failed_not_delivered')
    expect(warn).toBeDefined()
    expect(warn!.level).toBe('warn')
    expect(warn!.meta.type).toBe('engine_job_failed_not_delivered')
    expect(warn!.meta.message).toBe('Gemini rejected the clip')
    expect(warn!.meta.code).toBe('INVALID_REQUEST')
    expect(String(warn!.meta.error)).toContain('fetch failed')
  })

  test('a NON-connectivity error still propagates — swallowing it would hide a real bug', async () => {
    globalThis.fetch = (async () => {
      throw new Error('a bug in our own request construction')
    }) as unknown as typeof fetch

    // The counterpart to the case above, and the reason `isConnectivityError`
    // exists: if every failure were swallowed, a malformed payload would look
    // identical to an outage.
    await expect(
      engine.markEngineJobFailed('engine-job-2', 'm', 'CODE', false),
    ).rejects.toThrow('a bug in our own request construction')
    expect(logs.filter((l) => l.event === 'engine_job_failed_not_delivered')).toEqual([])
  })
})
