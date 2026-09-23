import { describe, expect, test } from 'bun:test'

import { resolveCaller } from '../src/lib/caller'

const OWNER = 'auth0|owner-1'

const requestWith = (verified: string | null): Request =>
  new Request('http://localhost/api/org/x/teams', {
    headers: verified ? { 'x-verified-auth0-id': verified } : {},
  })

describe('resolveCaller', () => {
  test('owner fast-path resolves without membership rows', async () => {
    const caller = await resolveCaller(OWNER, requestWith(OWNER))
    expect(caller.verified).toBe(OWNER)
    expect(caller.role).toBe('owner')
    expect(caller.can('team.create')).toBe(true)
    expect(caller.canAccessTeam('any-team')).toBe(true)
    expect(caller.studentScope).toEqual({ all: true })
  })

  test('missing identity resolves to an unauthorized caller', async () => {
    const caller = await resolveCaller(OWNER, requestWith(null))
    expect(caller.verified).toBeNull()
    expect(caller.role).toBeNull()
    expect(caller.teamIds).toEqual([])
    expect(caller.can('team.read')).toBe(false)
    expect(caller.canAccessTeam('any-team')).toBe(false)
    expect(caller.studentScope).toEqual({ all: false, teamIds: [] })
  })
})
