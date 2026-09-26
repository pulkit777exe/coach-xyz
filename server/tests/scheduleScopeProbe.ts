import { mock } from 'bun:test'
import type { SQL } from 'bun'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Schedule/season scope probe ───────────────────────────────────────────────
// Drives ONE schedule or seasons case for a list of caller roles in a fresh
// process and prints `[{ role, status, body, store, scopeLiteral }]` as the last
// stdout line. The caller (scheduleScope.test.ts) spawns it per case so the
// `mock.module` identity stubs stay out of the suite's shared module cache.
//
// What runs REAL here, because the question is what the SQL says: `resolveCaller`,
// the `permissions.ts` matrix (role → capability and `resolveStudentScope`),
// `lib/org/schedule.ts` and `lib/org/compete.ts`, and the route handlers. Only
// three things are stubbed: the identity lookups (member role + team ids +
// `getTeam`), `auditRoute`, and the SQL connection.
//
// The store is the REAL `historyStore` module wired to a fixture connection
// through its own `setHistoryStoreConnectionForTests` seam, so the tagged
// templates the data layers build are executed by the fixture: it applies each
// query's own bound scope parameters to the fixture rows, the way Postgres
// would, and counts every write so a refusal can be shown to have written
// nothing. An unrecognised query THROWS instead of returning [], so SQL drift
// fails loudly instead of quietly reading as "no rows".

const ORG_ID = 'auth0|org-owner'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
// A syntactically valid uuid that belongs to no team in this org: the 400 arm of
// the team guard, which must answer before the 403 scope arm.
const TEAM_FOREIGN = '00000000-0000-0000-0000-0000000000ff'
const EVENT_A = '00000000-0000-0000-0000-0000000000c1'
const EVENT_B = '00000000-0000-0000-0000-0000000000c2'
const EVENT_CLUB = '00000000-0000-0000-0000-0000000000c3'
const EVENT_MISSING = '00000000-0000-0000-0000-0000000000de'

const roleTokens = (process.env.SCHED_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
const probeCase = process.env.SCHED_SCOPE_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('SCHED_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

// `none` is an explicit empty team list: "manages no team", which is a
// different caller from an org-wide one and must stay different all the way
// down to the bound array.
const teamIds = (process.env.SCHED_SCOPE_TEAMS ?? 'none')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0 && t !== 'none')

const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// ── Fixtures ─────────────────────────────────────────────────────────────────
type EventRow = {
  id: string
  auth0_id: string
  title: string
  event_type: string
  starts_at: string
  ends_at: string | null
  location: string | null
  description: string | null
  status: string
  team_id: string | null
  created_at: string
  updated_at: string
}

const event = (id: string, title: string, teamId: string | null): EventRow => ({
  id,
  auth0_id: ORG_ID,
  title,
  event_type: 'practice',
  starts_at: '2026-03-01T10:00:00.000Z',
  ends_at: null,
  location: null,
  description: null,
  status: 'scheduled',
  team_id: teamId,
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
})

const EVENTS: EventRow[] = [
  event(EVENT_A, 'Team A practice', TEAM_A),
  event(EVENT_B, 'Team B practice', TEAM_B),
  event(EVENT_CLUB, 'Club open day', null),
]

type SeasonRow = {
  id: string
  org_auth0_id: string
  name: string
  starts_on: string | null
  ends_on: string | null
  created_at: string
}
const season = (id: string, name: string, createdAt: string): SeasonRow => ({
  id,
  org_auth0_id: ORG_ID,
  name,
  starts_on: '2026-01-01',
  ends_on: '2026-12-31',
  created_at: createdAt,
})

// Four seasons, one per case of the visibility rule: none, one club fixture,
// one team A fixture, one team B fixture.
const SEASONS: SeasonRow[] = [
  season('00000000-0000-0000-0000-0000000000d1', 'Unscheduled', '2026-01-04T00:00:00.000Z'),
  season('00000000-0000-0000-0000-0000000000d2', 'Club season', '2026-01-03T00:00:00.000Z'),
  season('00000000-0000-0000-0000-0000000000d3', 'Team A season', '2026-01-02T00:00:00.000Z'),
  season('00000000-0000-0000-0000-0000000000d4', 'Team B season', '2026-01-01T00:00:00.000Z'),
]

const SEASON_CLUB = '00000000-0000-0000-0000-0000000000d2'
const SEASON_A = '00000000-0000-0000-0000-0000000000d3'
const SEASON_B = '00000000-0000-0000-0000-0000000000d4'

type MatchRow = { season_id: string; team_id: string | null }
const MATCHES: MatchRow[] = [
  { season_id: SEASON_CLUB, team_id: null },
  { season_id: SEASON_A, team_id: TEAM_A },
  { season_id: SEASON_B, team_id: TEAM_B },
]

// ── Store spy + fixture answers ──────────────────────────────────────────────
type StoreLabels = {
  listSchedule: number
  getEvent: number
  listSeasons: number
  insertEvent: number
  updateEvent: number
  deleteEvent: number
}

const store: StoreLabels = {
  listSchedule: 0,
  getEvent: 0,
  listSeasons: 0,
  insertEvent: 0,
  updateEvent: 0,
  deleteEvent: 0,
}

const resetStore = () => {
  for (const key of Object.keys(store) as Array<keyof StoreLabels>) store[key] = 0
  scopeLiteralSeen = null
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** The first scope literal bound in this iteration — pinned by the caller. */
let scopeLiteralSeen: string | null = null

/**
 * The scope a query is asking for: bound as (boolean, uuid-array-literal | NULL).
 *
 * The array arrives as a Postgres literal string (`{a,b}`) because Bun sends a
 * raw JS array as comma-joined text and the `::uuid[]` cast then fails — so the
 * fixture reads the literal, exactly as Postgres would. A NULL literal is an
 * EMPTY scope, not an org-wide one, and it matches no team: `= any(NULL::uuid[])`
 * is NULL, not true.
 */
const boundScope = (params: unknown[]): { scoped: boolean; ids: Set<string> | null } => {
  const scoped = params.find((p): p is boolean => typeof p === 'boolean') === true
  const literal = params.find(
    (p): p is string => typeof p === 'string' && p.startsWith('{') && p.endsWith('}'),
  )
  if (literal && scopeLiteralSeen === null) scopeLiteralSeen = literal
  if (literal === undefined) return { scoped, ids: null }
  return {
    scoped,
    ids: new Set(
      literal
        .slice(1, -1)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  }
}

/**
 * `not scoped or team_id is null or team_id = any(…)` — the `listMatches` rule.
 *
 * `keepsClubRows` is read out of the statement rather than assumed, so this
 * fixture mirrors the SQL instead of re-implementing it: drop the `team_id is
 * null` arm from the query and the club fixtures stop coming back here too,
 * instead of this file quietly passing a mutated query.
 */
const eventVisible = (
  teamId: string | null,
  scope: ReturnType<typeof boundScope>,
  keepsClubRows: boolean,
): boolean => {
  if (!scope.scoped) return true
  if (teamId === null) return keepsClubRows
  return scope.ids?.has(teamId) ?? false
}

const answer = async (text: string, params: unknown[]): Promise<unknown[]> => {
  // DDL from `ensureInitialized` (the wrapper guarantees it runs first). Matched
  // anywhere in the statement because several of them open with `--` comments.
  if (
    /(create table|create index|create unique index|alter table|drop constraint|grant )/.test(text)
  ) {
    return []
  }
  // Idempotent-migration column probes: "no rows" means "add it below".
  if (text.includes('information_schema.columns')) return []

  // lib/org/schedule.ts — deleteScheduleEvent rides the tag (a fixed statement),
  // so the write half of the fixture sees it here and not in `unsafe`.
  if (text.includes('delete from schedule_events')) {
    store.deleteEvent += 1
    return EVENTS.some((e) => e.id === params[1]) ? [{ id: params[1] }] : []
  }
  // lib/org/schedule.ts — getScheduleEvent by id (the write path's load).
  if (text.includes('from schedule_events') && text.includes('limit 1')) {
    store.getEvent += 1
    return EVENTS.filter((e) => e.id === params[1])
  }
  // lib/org/schedule.ts — listSchedule.
  if (text.includes('from schedule_events')) {
    store.listSchedule += 1
    const scope = boundScope(params)
    return EVENTS.filter((e) => eventVisible(e.team_id, scope, text.includes('team_id is null')))
  }
  // lib/org/compete.ts — listSeasons: hidden only when it holds matches and none
  // of them is visible, so a season with no matches stays visible. Both arms are
  // read off the statement for the same reason as above.
  if (text.includes('from seasons')) {
    store.listSeasons += 1
    const scope = boundScope(params)
    if (!scope.scoped) return SEASONS
    const keepsEmptySeasons = text.includes('not exists')
    const keepsVisibleSeasons = text.includes('or exists')
    const keepsClubMatches = text.includes('m.team_id is null')
    return SEASONS.filter((s) => {
      const inSeason = MATCHES.filter((m) => m.season_id === s.id)
      if (inSeason.length === 0) return keepsEmptySeasons
      if (!keepsVisibleSeasons) return false
      return inSeason.some((m) => eventVisible(m.team_id, scope, keepsClubMatches))
    })
  }
  throw new Error(`fixture store received an unexpected query: ${text}`)
}

const tag = (strings: TemplateStringsArray, ...params: unknown[]) =>
  Promise.resolve(answer(normalize(strings.join(' ')), params))

/**
 * The write half of the fixture. `createScheduleEvent` / `updateScheduleEvent`
 * go through `db.unsafe` (dynamic column lists), so the column names are read
 * back out of the statement and the id out of its `where` clause — the same
 * shape the real query has. (`deleteScheduleEvent` uses a fixed statement and so
 * arrives through the tag above.)
 */
const unsafe = async (query: string, params: unknown[] = []): Promise<unknown[]> => {
  const text = normalize(query)
  if (text.includes('insert into schedule_events')) {
    store.insertEvent += 1
    const columns = /insert into schedule_events \(([^)]*)\)/.exec(text)?.[1]?.split(',') ?? []
    const row = Object.fromEntries(
      columns.map((column, i) => [column.trim(), i === 0 ? params[0] : params[i]]),
    ) as Partial<EventRow>
    return [event('00000000-0000-0000-0000-0000000000ff', 'Created', row.team_id ?? null)]
  }
  if (text.includes('update schedule_events')) {
    store.updateEvent += 1
    const id = params[params.length - 1]
    const existing = EVENTS.find((e) => e.id === id)
    if (!existing) return []
    const setColumns = /set (.*?) where /.exec(text)?.[1]?.match(/(\w+) = \$\d+/g) ?? []
    const row = { ...existing }
    setColumns.forEach((clause, i) => {
      const column = clause.split(' ')[0] ?? ''
      if (column === 'updated_at') return
      if (column in row) (row as Record<string, unknown>)[column] = params[i]
    })
    return [row]
  }
  // `ensureInitialized`'s CHECK-constraint value lists (`inList`).
  return []
}

const fixtureConnection = (() => {
  const stub = tag as unknown as SQL
  // Object.assign (not property assignment) keeps the stub's partial SQL surface
  // out of SQL's overloaded signatures — it implements exactly what
  // `ensureInitialized` and the data layers touch.
  Object.assign(stub, {
    connect: async () => {},
    unsafe: (query: string, params?: unknown[]) => unsafe(query, params),
    close: async () => {},
  })
  return stub
})()

// ── Identity layer ───────────────────────────────────────────────────────────
let currentRole: OrgMemberRole | null = null

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) =>
    teamId === TEAM_FOREIGN ? null : { id: teamId },
  listMemberTeamIds: async () => teamIds,
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

// Keep the app-level service guard inert: the stubbed membership already supplies
// the caller role, so the handlers' own guards are the only decisions under test.
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { setHistoryStoreConnectionForTests } = await import('../src/lib/historyStore')
setHistoryStoreConnectionForTests(fixtureConnection)

const scheduleRoute = (await import('../src/routes/org/schedule')).default
const competeRoute = (await import('../src/routes/org/compete')).default

const orgPath = 'auth0%7Corg-owner'
const call = async (
  route: { handle: (r: Request) => Promise<Response> },
  path: string,
  init?: RequestInit,
) => {
  const response = await route.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(currentRole),
      },
    }),
  )
  return { status: response.status, body: await response.json().catch(() => null) }
}

type Case = {
  route: 'schedule' | 'compete'
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

const schedulePath = (id?: string) => `/api/org/${orgPath}/schedule${id ? `/${id}` : ''}`

const eventBody = (extra: Record<string, unknown> = {}) => ({
  title: 'New practice',
  event_type: 'practice',
  starts_at: '2026-03-05T16:00:00.000Z',
  status: 'scheduled',
  ...extra,
})

const CASES: Record<string, Case> = {
  'read.list': { route: 'schedule', method: 'GET', path: schedulePath() },
  'read.seasons': {
    route: 'compete',
    method: 'GET',
    path: `/api/org/${orgPath}/seasons`,
  },
  'write.createClub': {
    route: 'schedule',
    method: 'POST',
    path: schedulePath(),
    body: eventBody(),
  },
  'write.createOwnTeam': {
    route: 'schedule',
    method: 'POST',
    path: schedulePath(),
    body: eventBody({ team_id: TEAM_A }),
  },
  'write.createOtherTeam': {
    route: 'schedule',
    method: 'POST',
    path: schedulePath(),
    body: eventBody({ team_id: TEAM_B }),
  },
  'write.createForeignTeam': {
    route: 'schedule',
    method: 'POST',
    path: schedulePath(),
    body: eventBody({ team_id: TEAM_FOREIGN }),
  },
  'write.updateOwnTeam': {
    route: 'schedule',
    method: 'PUT',
    path: schedulePath(EVENT_A),
    body: { status: 'completed' },
  },
  'write.updateOtherTeam': {
    route: 'schedule',
    method: 'PUT',
    path: schedulePath(EVENT_B),
    body: { status: 'completed' },
  },
  'write.updateClub': {
    route: 'schedule',
    method: 'PUT',
    path: schedulePath(EVENT_CLUB),
    body: { status: 'completed' },
  },
  'write.updatePromote': {
    // A team coach moving its own event onto the club-wide calendar: the same
    // hole as creating one without a team, reached through the update door.
    route: 'schedule',
    method: 'PUT',
    path: schedulePath(EVENT_A),
    body: { team_id: null },
  },
  'write.deleteOwnTeam': {
    route: 'schedule',
    method: 'DELETE',
    path: schedulePath(EVENT_A),
  },
  'write.deleteOtherTeam': {
    route: 'schedule',
    method: 'DELETE',
    path: schedulePath(EVENT_B),
  },
  'write.deleteClub': {
    route: 'schedule',
    method: 'DELETE',
    path: schedulePath(EVENT_CLUB),
  },
  'write.deleteMissing': {
    route: 'schedule',
    method: 'DELETE',
    path: schedulePath(EVENT_MISSING),
  },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const results: Array<{
  role: OrgMemberRole | null
  status: number
  body: unknown
  store: StoreLabels
  scopeLiteral: string | null
}> = []

for (const role of roleTokens) {
  currentRole = role
  resetStore()
  const route = probe.route === 'schedule' ? scheduleRoute : competeRoute
  const result = await call(route, probe.path, {
    method: probe.method,
    ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
  })
  results.push({
    role,
    status: result.status,
    body: result.body,
    store: { ...store },
    scopeLiteral: scopeLiteralSeen,
  })
}

console.log(JSON.stringify(results))
