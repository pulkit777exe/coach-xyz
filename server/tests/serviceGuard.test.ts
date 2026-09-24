import { afterEach, describe, expect, test } from 'bun:test'
import {
  SERVICE_HEADERS,
  isOrgScopedPath,
  resolveMemberRoleForPath,
  verifyServiceIdentity,
} from '../src/lib/serviceGuard'

const TOKEN = 'test-service-token'
const SUB = 'auth0|user-123'

function setToken(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

afterEach(() => {
  setToken(undefined)
})

describe('verifyServiceIdentity', () => {
  test('allows requests when the guard is disabled (no SERVICE_TOKEN)', () => {
    setToken(undefined)
    expect(verifyServiceIdentity(null, null, 'auth0|someone')).toEqual({
      ok: true,
    })
  })

  test('rejects missing service token when enabled', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(null, SUB, SUB)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(403)
    expect(outcome.body.code).toBe('FORBIDDEN')
  })

  test('rejects a wrong service token when enabled', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity('wrong-token', SUB, SUB)
    expect(outcome.ok).toBe(false)
  })

  test('rejects a missing verified id', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, null, SUB)
    expect(outcome.ok).toBe(false)
  })

  test('rejects a verified id that does not match the resource owner', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, 'auth0|other-user', SUB)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.body.code).toBe('FORBIDDEN')
  })

  test('rejects when the resource owner is unknown', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, SUB, undefined)
    expect(outcome.ok).toBe(false)
  })

  test('allows a matching verified identity when enabled', () => {
    setToken(TOKEN)
    expect(verifyServiceIdentity(TOKEN, SUB, SUB)).toEqual({ ok: true })
  })

  test('allows self-scoped routes with only the verified identity', () => {
    setToken(TOKEN)
    expect(verifyServiceIdentity(TOKEN, SUB, undefined, { self: true })).toEqual({
      ok: true,
    })
  })

  test('rejects self-scoped routes without a verified identity', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, null, undefined, {
      self: true,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(403)
  })

  test('reads the expected header names', () => {
    expect(SERVICE_HEADERS.token).toBe('x-service-token')
    expect(SERVICE_HEADERS.verifiedAuth0Id).toBe('x-verified-auth0-id')
  })

  test('allows a non-owner with an active org membership (memberRole given)', () => {
    setToken(TOKEN)
    expect(
      verifyServiceIdentity(TOKEN, 'auth0|member-1', 'auth0|owner-1', {
        memberRole: 'coach',
      }),
    ).toEqual({ ok: true })
  })

  test('denies a player-role member on /api/auth/user trees (allowedMemberRoles)', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, 'auth0|member-1', 'auth0|owner-1', {
      memberRole: 'player',
      allowedMemberRoles: ['owner', 'admin', 'coach', 'analyst'],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(403)
  })

  test('allows a coach-role member on /api/auth/user trees (allowedMemberRoles)', () => {
    setToken(TOKEN)
    expect(
      verifyServiceIdentity(TOKEN, 'auth0|member-1', 'auth0|owner-1', {
        memberRole: 'coach',
        allowedMemberRoles: ['owner', 'admin', 'coach', 'analyst'],
      }),
    ).toEqual({ ok: true })
  })

  test('player-role member without an allowlist still passes (org/email trees)', () => {
    setToken(TOKEN)
    expect(
      verifyServiceIdentity(TOKEN, 'auth0|member-1', 'auth0|owner-1', {
        memberRole: 'player',
      }),
    ).toEqual({ ok: true })
  })

  test('rejects a non-owner with a null memberRole', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, 'auth0|outsider', 'auth0|owner-1', {
      memberRole: null,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.body.code).toBe('FORBIDDEN')
  })

  test('still requires valid token even when memberRole is provided', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity('wrong-token', 'auth0|member-1', 'auth0|owner-1', {
      memberRole: 'coach',
    })
    expect(outcome.ok).toBe(false)
  })

  test('still requires a verified id even when memberRole is provided', () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, null, 'auth0|owner-1', {
      memberRole: 'coach',
    })
    expect(outcome.ok).toBe(false)
  })
})

// ── URL → pathname normalization (regression for b9fca0f) ───────────────────
// The global guard calls resolveMemberRoleForPath with the ABSOLUTE
// request.url, so the org-prefix check must normalize first — otherwise
// memberRole resolves to null for every caller and verifyServiceIdentity
// 403s all non-owner org members on /api/org|email|auth/user/:id/*.

describe('isOrgScopedPath (URL → pathname normalization)', () => {
  test('matches the org-scoped prefixes on an absolute request URL', () => {
    expect(isOrgScopedPath('http://localhost:8000/api/org/auth0|org-1/reports')).toBe(true)
    expect(isOrgScopedPath('http://localhost:8000/api/email/auth0|org-1/invite')).toBe(true)
    expect(isOrgScopedPath('http://localhost:8000/api/auth/user/auth0|coach-1/analyses')).toBe(true)
  })

  test('still matches a bare pathname (already-normalized callers)', () => {
    expect(isOrgScopedPath('/api/org/auth0|org-1/reports')).toBe(true)
    expect(isOrgScopedPath('/api/email/auth0|org-1/invite')).toBe(true)
    expect(isOrgScopedPath('/api/auth/user/auth0|coach-1/analyses')).toBe(true)
  })

  test('rejects absolute URLs outside the org-scoped trees', () => {
    expect(isOrgScopedPath('http://localhost:8000/api/me/profile')).toBe(false)
    expect(isOrgScopedPath('http://localhost:8000/api/scan/job-1')).toBe(false)
    expect(isOrgScopedPath('/api/me/profile')).toBe(false)
  })

  test('unparseable input falls back to raw prefix matching without throwing', () => {
    expect(isOrgScopedPath('not a url')).toBe(false)
    expect(isOrgScopedPath('')).toBe(false)
  })
})

describe('resolveMemberRoleForPath (absolute request.url input)', () => {
  test('owner on an absolute org URL returns null via the self fast-path (no DB hit)', async () => {
    await expect(
      resolveMemberRoleForPath(
        'http://localhost:8000/api/org/auth0|org-1/reports',
        'auth0|org-1',
        'auth0|org-1',
      ),
    ).resolves.toBeNull()
  })

  test('verified ≠ org on a non-org absolute URL stays null without querying membership', async () => {
    await expect(
      resolveMemberRoleForPath(
        'http://localhost:8000/api/me/profile',
        'auth0|org-1',
        'auth0|member-1',
      ),
    ).resolves.toBeNull()
  })
})
