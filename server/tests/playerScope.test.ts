import { describe, expect, mock, test } from 'bun:test'

import { resolvePlayerScope, withPlayerScope, withVerified } from '../src/lib/playerScope'

const verified = (): Request =>
  new Request('http://localhost/api/me/analyses', {
    headers: { 'x-verified-auth0-id': 'auth0|player-1' },
  })
const anonymous = (): Request => new Request('http://localhost/api/me/analyses')
const set = (): { status?: number | string } => ({})

describe('withVerified', () => {
  test('missing identity maps to 403 without running the handler', async () => {
    const fn = mock(async () => ({ ok: true }))
    const box = set()
    const res = await withVerified(anonymous(), box, fn)
    expect(box.status).toBe(403)
    expect(res).toMatchObject({ code: 'FORBIDDEN' })
    expect(fn).not.toHaveBeenCalled()
  })

  test('verified callers run with their sub', async () => {
    const fn = mock(async (sub: string) => ({ sub }))
    const res = await withVerified(verified(), set(), fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ sub: 'auth0|player-1' })
  })
})

describe('resolvePlayerScope', () => {
  test('resolves linked players to the owning coach scope', async () => {
    const scope = await resolvePlayerScope('auth0|player-1', {
      resolveAuth0Id: async () => 'auth0|primary-1',
      getLinkedPlayer: async () => ({
        student: { id: 'stu-1' } as never,
        coachAuth0Id: 'auth0|coach-1',
      }),
    })
    expect(scope).toMatchObject({
      accountAuth0Id: 'auth0|primary-1',
      student: { id: 'stu-1' },
      coachAuth0Id: 'auth0|coach-1',
    })
  })

  test('unlinked accounts resolve to null scope fields', async () => {
    const scope = await resolvePlayerScope('auth0|player-1', {
      resolveAuth0Id: async (sub) => sub,
      getLinkedPlayer: async () => null,
    })
    expect(scope.student).toBeNull()
    expect(scope.coachAuth0Id).toBeNull()
  })
})

describe('withPlayerScope', () => {
  const deps = {
    resolveAuth0Id: async (sub: string) => sub,
    getLinkedPlayer: async () => ({
      student: { id: 'stu-1' } as never,
      coachAuth0Id: 'auth0|coach-1',
    }),
  }

  test('unlinked callers get their empty shape with a 200', async () => {
    const fn = mock(async () => ({ analyses: ['x'] }))
    const box = set()
    const res = await withPlayerScope(verified(), box, { analyses: [], linked: false }, fn, {
      ...deps,
      getLinkedPlayer: async () => null,
    })
    expect(box.status).toBe(200)
    expect(res).toEqual({ analyses: [], linked: false })
    expect(fn).not.toHaveBeenCalled()
  })

  test('linked callers run with a fully-resolved scope', async () => {
    const fn = mock(async (scope: unknown) => scope)
    const res = await withPlayerScope(verified(), set(), { analyses: [], linked: false }, fn, deps)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({
      accountAuth0Id: 'auth0|player-1',
      student: { id: 'stu-1' },
      coachAuth0Id: 'auth0|coach-1',
    })
  })
})
