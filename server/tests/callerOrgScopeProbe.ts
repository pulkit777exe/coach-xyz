// Resolves callers for a coach holding teams in two orgs, in a fresh process
// so no other file's `mock.module` stubs can interfere. The store stub
// emulates Postgres filtering by the bound org value, proving the org
// predicate reaches the database rather than being filtered in JS.
// Prints the resolution for both orgs plus the recorded team query.

import { mock } from 'bun:test'

const ORG_A = 'auth0|org-a'
const ORG_B = 'auth0|org-b'
const COACH = 'auth0|two-org-coach'

const TEAM_ROWS = [
  { team_id: 'team-a', org: ORG_A },
  { team_id: 'team-b', org: ORG_B },
]

const teamQueries: Array<{ sql: string; values: unknown[] }> = []

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const db = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (/from org_members/.test(sql)) return [{ role: 'coach' }]
      if (/from team_memberships/.test(sql)) {
        teamQueries.push({ sql, values })
        return TEAM_ROWS.filter((r) => values.includes(r.org)).map((r) => ({
          team_id: r.team_id,
        }))
      }
      return []
    }
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { resolveCaller } = await import('../src/lib/caller')

const requestWith = (verified: string): Request =>
  new Request('http://localhost/api/org/x/teams', {
    headers: { 'x-verified-auth0-id': verified },
  })

const inA = await resolveCaller(ORG_A, requestWith(COACH))
const inB = await resolveCaller(ORG_B, requestWith(COACH))

console.log(
  JSON.stringify({
    role: inA.role,
    teamIdsA: inA.teamIds,
    teamIdsB: inB.teamIds,
    teamQueries,
  }),
)
