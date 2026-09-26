import { mock } from 'bun:test'
import type { SQL } from 'bun'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org read-scope probe ─────────────────────────────────────────────────────
// Drives ONE org read/aggregate surface for a list of caller roles in a fresh
// process and prints `[{ role, status, body, store, writes }]` as the last
// stdout line. The caller (orgReadScope.test.ts) spawns it once per
// (case, team-set) so Bun's `mock.module` overrides never leak into the rest of
// the suite's module cache.
//
// What runs REAL here, because the question is what the SQL says: `resolveCaller`,
// the `permissions.ts` matrix, the `lib/org/scope.ts` seam, all three data
// layers (`lib/org/overview.ts`, `lib/org/students.ts`, `lib/org/wellness.ts`)
// and the route handlers. Only three things are stubbed: the identity lookups
// (member role + team ids), `auditRoute`, and the SQL connection.
//
// The store is the REAL `historyStore` module wired to a fixture connection
// through its own `setHistoryStoreConnectionForTests` seam, so the tagged
// templates the data layer builds are actually executed by the fixture: it
// applies each query's own bound scope parameters to the fixture rows, the way
// Postgres would. An unrecognised query THROWS instead of returning [], so SQL
// drift fails loudly instead of quietly reading as "no rows".

const ORG_ID = 'auth0|org-owner'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
// Two players on team A (one active, one transferred) and one on team B, so
// student_count, active_students and avg_attendance_rate each differ per scope.
const S_A1 = '00000000-0000-0000-0000-0000000000a2'
const S_A2 = '00000000-0000-0000-0000-0000000000a3'
const S_B1 = '00000000-0000-0000-0000-0000000000b2'

const STUDENT_BY_TOKEN: Record<string, string> = { a: S_A1, a2: S_A2, b: S_B1 }

// ── Case inputs ──────────────────────────────────────────────────────────────
const roleTokens = (process.env.ORG_READ_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
const probeCase = process.env.ORG_READ_SCOPE_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('ORG_READ_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

// `none` is an explicit empty team list: "manages no team", which is a
// different caller from an org-wide one and must stay different all the way down.
const teamIds = (process.env.ORG_READ_SCOPE_TEAMS ?? 'none')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0 && t !== 'none')

// The member is never the org owner, so `resolveCaller` must resolve a real
// membership rather than take the owner fast-path.
const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// ── Fixtures ─────────────────────────────────────────────────────────────────
type StudentRow = {
  id: string
  full_name: string
  email: string | null
  sport: string | null
  position: string | null
  status: string
  team_id: string
}

const STUDENTS: StudentRow[] = [
  {
    id: S_A1,
    full_name: 'Player A1',
    email: 'a1@example.com',
    sport: 'soccer',
    position: 'striker',
    status: 'active',
    team_id: TEAM_A,
  },
  {
    id: S_A2,
    full_name: 'Player A2',
    email: 'a2@example.com',
    sport: 'soccer',
    position: 'keeper',
    status: 'transferred',
    team_id: TEAM_A,
  },
  {
    id: S_B1,
    full_name: 'Player B1',
    email: 'b1@example.com',
    sport: 'soccer',
    position: 'midfield',
    status: 'active',
    team_id: TEAM_B,
  },
]

// Attendance is 30-day-bound by the query itself; every fixture row is in range.
const ATTENDANCE: Array<{ student_id: string; status: string }> = [
  { student_id: S_A1, status: 'present' },
  { student_id: S_A2, status: 'late' },
  { student_id: S_B1, status: 'absent' },
]

// `team_id` is what makes these scopeable at all: null is a club-wide fixture
// that stays visible to everyone, a set id must be one of the caller's teams
// (the listSchedule rule).
const SCHEDULE: Array<{
  id: string
  title: string
  event_type: string
  starts_at: string
  location: string | null
  description: string | null
  status: string
  this_month: boolean
  upcoming: boolean
  team_id: string | null
}> = [
  {
    id: '00000000-0000-0000-0000-0000000000e1',
    title: 'Player squad session',
    event_type: 'practice',
    starts_at: '2026-09-02T10:00:00Z',
    location: 'Pitch 1',
    description: 'Team training',
    status: 'scheduled',
    this_month: true,
    upcoming: false,
    team_id: TEAM_A,
  },
  {
    id: '00000000-0000-0000-0000-0000000000e2',
    title: 'Player friendly',
    event_type: 'match',
    starts_at: '2026-09-20T10:00:00Z',
    location: 'Stadium',
    description: null,
    status: 'scheduled',
    this_month: true,
    upcoming: true,
    team_id: TEAM_B,
  },
  {
    id: '00000000-0000-0000-0000-0000000000e3',
    title: 'Club open day',
    event_type: 'meeting',
    starts_at: '2026-09-11T10:00:00Z',
    location: 'Clubhouse',
    description: 'Everyone',
    status: 'scheduled',
    this_month: true,
    upcoming: true,
    team_id: null,
  },
]

const REPORTS: Array<{
  id: string
  title: string
  report_type: string
  created_at: string
  student_id: string | null
}> = [
  {
    id: '00000000-0000-0000-0000-0000000000f1',
    title: 'Player report A1',
    report_type: 'progress',
    created_at: '2026-09-01T00:00:00Z',
    student_id: S_A1,
  },
  {
    id: '00000000-0000-0000-0000-0000000000f2',
    title: 'Player report B1',
    report_type: 'progress',
    created_at: '2026-09-02T00:00:00Z',
    student_id: S_B1,
  },
  {
    // Attributed to no player: names no team, so a scoped caller keeps it.
    id: '00000000-0000-0000-0000-0000000000f3',
    title: 'Player club handbook',
    report_type: 'summary',
    created_at: '2026-09-03T00:00:00Z',
    student_id: null,
  },
]

const ANALYSES: Array<{
  server_job_id: string
  display_name: string | null
  student_id: string | null
  requested_at: string
  file_name: string | null
}> = [
  {
    server_job_id: 'job-a1',
    display_name: 'Player clip A1',
    student_id: S_A1,
    requested_at: '2026-09-01T00:00:00Z',
    file_name: 'a1.mp4',
  },
  {
    server_job_id: 'job-b1',
    display_name: 'Player clip B1',
    student_id: S_B1,
    requested_at: '2026-09-02T00:00:00Z',
    file_name: 'b1.mp4',
  },
  {
    server_job_id: 'job-open',
    display_name: 'Player clip unlinked',
    student_id: null,
    requested_at: '2026-09-03T00:00:00Z',
    file_name: 'open.mp4',
  },
]

const WELLNESS: Array<Record<string, unknown>> = [
  {
    id: '00000000-0000-0000-0000-000000000101',
    org_auth0_id: ORG_ID,
    student_id: S_A1,
    sleep_hours: 8,
    fatigue: 2,
    pain: null,
    availability: 'full',
    note: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000102',
    org_auth0_id: ORG_ID,
    student_id: S_B1,
    sleep_hours: 5,
    fatigue: 4,
    pain: 'ankle',
    availability: 'modified',
    note: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
  },
]

// ── Store spy + fixture answers ──────────────────────────────────────────────
type StoreLabels = {
  scopeIds: number
  overview: number
  searchStudents: number
  searchSchedule: number
  calendarTeamFilters: number
  searchReports: number
  searchAnalyses: number
  getStudent: number
  wellnessSelect: number
  wellnessInsert: number
}

const store: StoreLabels = {
  scopeIds: 0,
  overview: 0,
  searchStudents: 0,
  searchSchedule: 0,
  // How many schedule subqueries actually bind the team filter. Counted from the
  // statement text, not the params: a param-based fixture keeps applying the
  // scope even when the SQL stops filtering on it, which is how a dropped filter
  // hides behind a green test.
  calendarTeamFilters: 0,
  searchReports: 0,
  searchAnalyses: 0,
  getStudent: 0,
  wellnessSelect: 0,
  wellnessInsert: 0,
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
 * fixture reads the literal, exactly as Postgres would.
 */
/**
 * Team scope as the fixture sees it. The overview statement binds one
 * (auth0_id, bool, literal) triple per subquery, so position is not a reliable
 * signal — six subqueries share the shape. What does distinguish them: the team
 * filter binds a literal of TEAM ids, every student filter binds a literal of
 * STUDENT ids. So the team scope is the bound literal made only of known team
 * ids. Returns null when no such literal is bound, which is the org-wide case
 * (and matches listSchedule: a team-less event is a club fixture, visible to
 * everyone).
 */
const KNOWN_TEAM_IDS = new Set(STUDENTS.map((s) => s.team_id).filter((t): t is string => !!t))

const boundTeamScope = (params: unknown[]): Set<string> | null => {
  for (const p of params) {
    if (typeof p !== 'string' || !p.startsWith('{') || !p.endsWith('}')) continue
    const ids = p
      .slice(1, -1)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (ids.length > 0 && ids.every((id) => KNOWN_TEAM_IDS.has(id))) return new Set(ids)
  }
  return null
}

/** Events a caller may see: their own teams, plus every club-wide fixture. */
const visibleEvents = (teams: Set<string> | null) =>
  teams === null ? SCHEDULE : SCHEDULE.filter((e) => e.team_id === null || teams.has(e.team_id))

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

const visible = <T extends { student_id: string | null }>(
  rows: T[],
  scope: { scoped: boolean; ids: Set<string> | null },
): T[] => {
  if (!scope.scoped || !scope.ids) return rows
  const ids = scope.ids
  return rows.filter((r) => r.student_id === null || ids.has(r.student_id))
}

const ilike = (value: string | null, like: string) =>
  typeof value === 'string' && value.toLowerCase().includes(like.toLowerCase())

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
  // Counted centrally, from the statement text, so it covers every statement
  // rather than one branch. Statements without the clause contribute nothing.
  store.calendarTeamFilters += (text.match(/team_id is null or team_id = any/g) ?? []).length
  const scope = boundScope(params)
  const like = String(
    params.find((p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')) ?? '%%',
  ).slice(1, -1)

  // lib/org/scope.ts — the one query the seam runs.
  if (text.includes('select id from students') && text.includes('team_id = any(')) {
    store.scopeIds += 1
    const literal = typeof params[1] === 'string' ? params[1] : ''
    const teams = new Set(
      literal
        .slice(1, -1)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    )
    return STUDENTS.filter((s) => teams.has(s.team_id)).map((s) => ({ id: s.id }))
  }
  // lib/org/students.ts — getStudent by id.
  if (text.includes('from students') && text.includes('limit 1')) {
    store.getStudent += 1
    return STUDENTS.filter((s) => s.id === params[1])
  }
  // lib/org/overview.ts — the rollup.
  if (text.includes('as student_count')) {
    store.overview += 1
    const ids = scope.ids
    const students = ids ? STUDENTS.filter((s) => ids.has(s.id)) : STUDENTS
    const attendance = ids ? ATTENDANCE.filter((a) => ids.has(a.student_id)) : ATTENDANCE
    const attended = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
    return [
      {
        student_count: students.length,
        active_students: students.filter((s) => s.status === 'active').length,
        sessions_this_month: visibleEvents(boundTeamScope(params)).filter((e) => e.this_month)
          .length,
        upcoming_events: visibleEvents(boundTeamScope(params)).filter(
          (e) => e.upcoming && e.status === 'scheduled',
        ).length,
        analyses_linked: visible(ANALYSES, scope).filter((a) => a.student_id !== null).length,
        avg_attendance_rate:
          attendance.length === 0 ? null : Math.round((attended * 1000) / attendance.length) / 10,
      },
    ]
  }
  // lib/org/overview.ts — search: roster rows are scope-exact.
  if (text.includes('from students') && text.includes('full_name ilike')) {
    store.searchStudents += 1
    const rows = scope.ids ? STUDENTS.filter((s) => scope.ids!.has(s.id)) : STUDENTS
    return rows.filter(
      (s) =>
        ilike(s.full_name, like) ||
        ilike(s.email, like) ||
        ilike(s.sport, like) ||
        ilike(s.position, like),
    )
  }
  // Team-keyed since schedule_events gained team_id; a null team is a club
  // fixture and stays visible.
  if (text.includes('from schedule_events')) {
    store.searchSchedule += 1
    return visibleEvents(boundTeamScope(params)).filter(
      (e) =>
        ilike(e.title, like) ||
        ilike(e.location, like) ||
        ilike(e.event_type, like) ||
        ilike(e.description, like),
    )
  }
  if (text.includes('from reports r')) {
    store.searchReports += 1
    return visible(REPORTS, scope)
      .map((r) => ({
        ...r,
        full_name: r.student_id
          ? (STUDENTS.find((s) => s.id === r.student_id)?.full_name ?? null)
          : null,
      }))
      .filter((r) => ilike(r.title, like) || ilike(r.report_type, like) || ilike(r.full_name, like))
  }
  if (text.includes('from analysis_history a')) {
    store.searchAnalyses += 1
    return visible(ANALYSES, scope).filter(
      (a) =>
        ilike(a.display_name, like) || ilike(a.server_job_id, like) || ilike(a.file_name, like),
    )
  }
  if (text.includes('from wellness_checkins')) {
    store.wellnessSelect += 1
    return WELLNESS.filter((w) => w.student_id === params[1])
  }
  if (text.includes('insert into wellness_checkins')) {
    store.wellnessInsert += 1
    return [
      {
        id: '00000000-0000-0000-0000-000000000199',
        org_auth0_id: params[0],
        student_id: params[1],
        sleep_hours: params[2],
        fatigue: params[3],
        pain: params[4],
        availability: params[5],
        note: params[6],
        created_by: params[7],
        created_at: '2026-09-26T00:00:00Z',
      },
    ]
  }
  throw new Error(`fixture store received an unexpected query: ${text}`)
}

const tag = (strings: TemplateStringsArray, ...params: unknown[]) =>
  Promise.resolve(answer(normalize(strings.join(' ')), params))

const fixtureConnection = (() => {
  const stub = tag as unknown as SQL
  // Object.assign (not property assignment) keeps the stub's partial SQL surface
  // out of SQL's overloaded signatures — it implements exactly what
  // `ensureInitialized` touches: the template call, connect, unsafe, close.
  Object.assign(stub, {
    connect: async () => {},
    unsafe: async () => [],
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
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
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

const { resolveCaller } = await import('../src/lib/caller')
const overviewRoute = (await import('../src/routes/org/overview')).default
const wellnessRoute = (await import('../src/routes/org/wellness')).default
const { getStudent } = await import('../src/lib/org/students')

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
        ...(init?.headers as Record<string, string> | undefined),
      },
    }),
  )
  return { status: response.status, body: await response.json().catch(() => null) }
}

type Case =
  | { kind: 'route'; route: 'overview' | 'wellness'; path: string; method: string; body?: unknown }
  | { kind: 'student'; student: string }

const CASES: Record<string, Case> = {
  'overview.get': {
    kind: 'route',
    route: 'overview',
    method: 'GET',
    path: `/api/org/${orgPath}/overview`,
  },
  'overview.search': {
    kind: 'route',
    route: 'overview',
    method: 'GET',
    path: `/api/org/${orgPath}/search?q=Player`,
  },
  'wellness.read.own': {
    kind: 'route',
    route: 'wellness',
    method: 'GET',
    path: `/api/org/${orgPath}/students/${S_A1}/wellness`,
  },
  'wellness.read.teamB': {
    kind: 'route',
    route: 'wellness',
    method: 'GET',
    path: `/api/org/${orgPath}/students/${S_B1}/wellness`,
  },
  'wellness.write.own': {
    kind: 'route',
    route: 'wellness',
    method: 'POST',
    path: `/api/org/${orgPath}/students/${S_A1}/wellness`,
    body: { sleep_hours: 7, fatigue: 2, pain: 'calf' },
  },
  'wellness.write.teamB': {
    kind: 'route',
    route: 'wellness',
    method: 'POST',
    path: `/api/org/${orgPath}/students/${S_B1}/wellness`,
    body: { sleep_hours: 7, fatigue: 2, pain: 'calf' },
  },
  'student.get.own': { kind: 'student', student: 'a' },
  'student.get.teamB': { kind: 'student', student: 'b' },
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
  student: string | null
  store: StoreLabels
  scopeLiteral: string | null
}> = []

for (const role of roleTokens) {
  currentRole = role
  resetStore()
  const request = new Request('http://localhost/', {
    headers: { 'x-verified-auth0-id': memberIdFor(role) },
  })

  if (probe.kind === 'student') {
    // The data layer, with the caller's real scope: the by-id door into the
    // roster, below every route.
    const caller = await resolveCaller(ORG_ID, request)
    const student = await getStudent(
      ORG_ID,
      STUDENT_BY_TOKEN[probe.student] ?? S_B1,
      caller.studentScope,
    )
    results.push({
      role,
      status: student ? 200 : 404,
      body: student,
      student: student?.id ?? null,
      store: { ...store },
      scopeLiteral: scopeLiteralSeen,
    })
    continue
  }

  const route = probe.route === 'overview' ? overviewRoute : wellnessRoute
  const result = await call(route, probe.path, {
    method: probe.method,
    ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
  })
  results.push({
    role,
    status: result.status,
    body: result.body,
    student: null,
    store: { ...store },
    scopeLiteral: scopeLiteralSeen,
  })
}

console.log(JSON.stringify(results))
