import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { resolveCaller } from '../src/lib/caller'

const OWNER = 'auth0|owner-1'
const ORG_A = 'auth0|org-a'
const ORG_B = 'auth0|org-b'
const COACH = 'auth0|two-org-coach'

// A coach holding teams in two orgs. The stub emulates Postgres filtering: it
// returns only the rows whose org matches the bound org value, so the test
// proves the org predicate reaches the database rather than being filtered in JS.
const TEAM_ROWS = [
  { team_id: 'team-a', org: ORG_A },
  { team_id: 'team-b', org: ORG_B },
]

let teamQueries: Array<{ sql: string; values: unknown[] }> = []
let restore: (() => void) | null = null

const useOrgFilteringStore = (): void => {
  teamQueries = []
  if (restore) return
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    if (/from org_members/.test(sql)) return [{ role: 'coach' }]
    if (/from team_memberships/.test(sql)) {
      teamQueries.push({ sql, values })
      return TEAM_ROWS.filter((r) => values.includes(r.org)).map((r) => ({
        team_id: r.team_id,
      }))
    }
    return []
  }) as unknown as SQL
  restore = setHistoryStoreConnectionForTests(
    Object.assign(tag, {
      connect: async () => {},
      unsafe: async () => [],
      close: async () => {},
    }) as unknown as SQL,
  )
}

afterEach(() => {
  restore?.()
  restore = null
})

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

  test('a coach with teams in two orgs sees only the current org teams', async () => {
    useOrgFilteringStore()
    const inA = await resolveCaller(ORG_A, requestWith(COACH))
    expect(inA.role).toBe('coach')
    expect(inA.teamIds).toEqual(['team-a'])
    const inB = await resolveCaller(ORG_B, requestWith(COACH))
    expect(inB.teamIds).toEqual(['team-b'])
  })

  test('the team lookup joins teams and predicates on the org', async () => {
    // The cross-org leak came from a lookup with no org predicate at all; pin
    // the join so a future edit cannot silently drop it.
    useOrgFilteringStore()
    await resolveCaller(ORG_A, requestWith(COACH))
    expect(teamQueries.length).toBeGreaterThan(0)
    const q = teamQueries[teamQueries.length - 1]
    expect(q.sql).toMatch(/join teams/)
    expect(q.sql).toMatch(/org_auth0_id/)
    expect(q.values).toContain(ORG_A)
    expect(q.values).toContain(COACH)
  })
})
