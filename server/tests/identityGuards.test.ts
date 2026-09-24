import { describe, expect, test, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import meRoutes from '../src/routes/me'
import notificationsRoutes from '../src/routes/notifications'
import { missingVerifiedSelf, requireVerifiedSelf } from '../src/lib/caller'

// ── Route-level identity-boundary coverage ──────────────────────────────────
// /api/me/* handlers enforce the verified-identity check themselves (when
// SERVICE_TOKEN is unset the global serviceGuard is inert by design), so both
// enforcement paths are pinned to the byte-identical 403 body — and the source
// structure below keeps the 5-line incantation from creeping back in.

const TEST_SERVICE_TOKEN = 'test-service-token'
const VERIFIED = 'auth0|player-123'

const MISSING_IDENTITY_BODY = {
  code: 'FORBIDDEN',
  message: 'Missing verified identity',
  layer: 'server',
  retryable: false,
}

const setToken = (value?: string) => {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

const getReq = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers })

const postReq = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers })

// A rejection here means the handler itself threw AFTER the guard let the
// request through (guards return responses, they never throw) — so a thrown
// handler still counts as "the guard was passed".
const statusAfterGuard = (handled: Promise<Response>): Promise<number | 'handler-threw'> =>
  handled.then(
    (res) => res.status,
    () => 'handler-threw' as const,
  )

afterEach(() => setToken(undefined))

describe('route-level verified-identity guards', () => {
  test('GET /api/me/profile without the verified header → pinned 403 (guard disabled: handler check is the only enforcement)', async () => {
    setToken(undefined)
    const res = await meRoutes.handle(getReq('/api/me/profile'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(MISSING_IDENTITY_BODY)
  })

  test('GET /api/me/profile with a present-but-empty verified header → identical pinned 403', async () => {
    setToken(undefined)
    const res = await meRoutes.handle(getReq('/api/me/profile', { 'x-verified-auth0-id': '' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(MISSING_IDENTITY_BODY)
  })

  test('guard enabled: valid service token but no verified id → same pinned 403 from the global guard', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const res = await meRoutes.handle(
      getReq('/api/me/profile', { 'x-service-token': TEST_SERVICE_TOKEN }),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(MISSING_IDENTITY_BODY)
  })

  test('GET /api/me/profile with the verified header passes the guard', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const status = await statusAfterGuard(
      meRoutes.handle(
        getReq('/api/me/profile', {
          'x-service-token': TEST_SERVICE_TOKEN,
          'x-verified-auth0-id': VERIFIED,
        }),
      ),
    )
    expect(status).not.toBe(403)
  })

  test('GET /api/me/notifications without the verified header → pinned 403', async () => {
    setToken(undefined)
    const res = await notificationsRoutes.handle(getReq('/api/me/notifications'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(MISSING_IDENTITY_BODY)
  })

  test('GET /api/me/notifications with the verified header passes the guard', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const status = await statusAfterGuard(
      notificationsRoutes.handle(
        getReq('/api/me/notifications', {
          'x-service-token': TEST_SERVICE_TOKEN,
          'x-verified-auth0-id': VERIFIED,
        }),
      ),
    )
    expect(status).not.toBe(403)
  })

  test('POST /api/me/notifications/read-all without the verified header → pinned 403', async () => {
    setToken(undefined)
    const res = await notificationsRoutes.handle(postReq('/api/me/notifications/read-all'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(MISSING_IDENTITY_BODY)
  })
})

describe('requireVerifiedSelf / missingVerifiedSelf predicate', () => {
  const ctx = (headers: HeadersInit = {}) => ({
    request: new Request('http://localhost/api/me/profile', { headers }),
    set: {} as { status?: number | string },
  })

  test('missing header → 403 set on `set` + pinned body returned', () => {
    const context = ctx()
    const out = requireVerifiedSelf(context)
    expect(context.set.status).toBe(403)
    expect(out).toEqual(MISSING_IDENTITY_BODY)
  })

  test('present-but-empty header → identical rejection (falsy check, not null check)', () => {
    const context = ctx({ 'x-verified-auth0-id': '' })
    const out = requireVerifiedSelf(context)
    expect(context.set.status).toBe(403)
    expect(out).toEqual(MISSING_IDENTITY_BODY)
  })

  test('present header → returns the id untouched, status untouched', () => {
    const context = ctx({ 'x-verified-auth0-id': VERIFIED })
    expect(requireVerifiedSelf(context)).toBe(VERIFIED)
    expect(context.set.status).toBeUndefined()
  })

  test('missingVerifiedSelf → the canonical { ok: false, status: 403 } rejection', () => {
    expect(missingVerifiedSelf()).toEqual({ ok: false, status: 403, error: MISSING_IDENTITY_BODY })
  })
})

describe('self-scope routes are wired to the shared helper (source structure)', () => {
  const srcOf = (relPath: string) => readFileSync(join(import.meta.dir, relPath), 'utf8')
  const countOf = (src: string, pattern: RegExp) => (src.match(pattern) ?? []).length

  // FORBIDDEN bodies that are legitimately NOT the identity check (the
  // structural identity of every other FORBIDDEN literal in the file).
  const allowedForbidden: Record<string, string[]> = {
    'me.ts': ['No linked player account'],
    'notifications.ts': [],
  }

  for (const file of ['me.ts', 'notifications.ts'] as const) {
    const routeSrc = () => srcOf(join('..', 'src', 'routes', file))

    test(`${file}: the 'Missing verified identity' incantation appears zero times`, () => {
      expect(countOf(routeSrc(), /'Missing verified identity'/g)).toBe(0)
    })

    test(`${file}: every registered route handler calls requireVerifiedSelf`, () => {
      const src = routeSrc()
      const routeCount = countOf(src, /^\s*\.(?:get|post|put|patch|delete)\(\s*['"]/gm)
      const helperCalls = countOf(src, /requireVerifiedSelf\(/g)
      expect(routeCount).toBeGreaterThan(0)
      expect(helperCalls).toBe(routeCount)
    })

    test(`${file}: FORBIDDEN bodies are only the documented non-identity exceptions`, () => {
      const messages = [...routeSrc().matchAll(/buildError\(\s*'FORBIDDEN',\s*'([^']*)'/g)].map(
        (m) => m[1],
      )
      expect(messages).toEqual(allowedForbidden[file])
    })
  }

  test("lib/caller.ts owns the single 'Missing verified identity' literal", () => {
    expect(
      countOf(srcOf(join('..', 'src', 'lib', 'caller.ts')), /'Missing verified identity'/g),
    ).toBe(1)
  })
})
