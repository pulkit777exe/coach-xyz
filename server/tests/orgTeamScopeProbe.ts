import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org team-scope probe (reports / objectives / plans) ───────────────────────
// Drives ONE org route for a list of caller roles in a fresh process, printing
// `[{ role, status, body, writes, reads, storeQueries, listOpts, createInput }]`
// as the last stdout line. The caller (orgTeamScope.test.ts) spawns it once per
// case so Bun's `mock.module` overrides never leak into the rest of the suite's
// shared module cache.
//
// The real `resolveCaller`, the real `permissions.ts` matrix, the real
// `lib/org/scope.ts` seam and the real `objectiveVisibleTo` / `planVisibleTo`
// predicates all run. Only three things are stubbed: the identity layer (role +
// team memberships), the store (the one query `visibleStudentIds` makes) and the
// data layer (fixtures in, write counters out). So an "allowed" case proves the
// route's own check agreed with the policy, and a refused write proves the
// capability gate and the scope gate both sat in front of the store.
//
// NOTE: every data-layer import below is a DYNAMIC import. `lib/org/scope.ts`
// captures `withHistoryStoreOrThrow` at module-eval time, so a static import of
// a data-layer module at the top of this file would bind the REAL historyStore
// before the store stub is registered.

const ORG_ID = 'auth0|org-owner'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a2'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b2'
const REPORT_A = '00000000-0000-0000-0000-0000000000a3'
const REPORT_B = '00000000-0000-0000-0000-0000000000b3'
const OBJ_TEAM_A = '00000000-0000-0000-0000-0000000000a4'
const OBJ_TEAM_B = '00000000-0000-0000-0000-0000000000b4'
const OBJ_STUDENT_B = '00000000-0000-0000-0000-0000000000b5'
const PLAN_TEAM_A = '00000000-0000-0000-0000-0000000000a6'
const PLAN_TEAM_B = '00000000-0000-0000-0000-0000000000b6'
const PLAN_STUDENT_B = '00000000-0000-0000-0000-0000000000b7'

/** A coach who manages no team: the caller whose visible set is empty. */
const UNASSIGNED = '__unassigned_coach__'

const roleTokens = (process.env.ORG_TEAM_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
const probeCase = process.env.ORG_TEAM_SCOPE_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('ORG_TEAM_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

// Never the org owner, so `resolveCaller` must resolve a real membership.
const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// Per-role team memberships. `owner`/`admin` bypass the lookup in resolveCaller;
// `analyst`/`medical` are the org-wide readers and are deliberately given NO
// team — the policy says they still see the whole org.
const TEAM_FOR_ROLE: Record<string, string[]> = {
  head_coach: [TEAM_A],
  assistant_coach: [TEAM_A],
  coach: [TEAM_A],
  analyst: [],
  medical: [],
  player: [],
  admin: [],
  owner: [],
}
const STUDENTS_ON_TEAM: Record<string, string[]> = {
  [TEAM_A]: [STUDENT_A],
  [TEAM_B]: [STUDENT_B],
}

let currentRole: OrgMemberRole | null = null
/** True only for the synthetic coach who manages no team. */
let currentRoleIsUnassigned = false
const teamsFor = (role: OrgMemberRole | null): string[] =>
  role && role in TEAM_FOR_ROLE ? TEAM_FOR_ROLE[role] : []
const teamsForCurrentCaller = (): string[] => (currentRoleIsUnassigned ? [] : teamsFor(currentRole))

// ── Store spy ────────────────────────────────────────────────────────────────
type WriteKey =
  | 'createReportRecord'
  | 'updateReportRecord'
  | 'deleteReport'
  | 'createObjective'
  | 'setObjectiveStatus'
  | 'deleteObjective'
  | 'createTrainingPlan'
  | 'setTrainingPlanStatus'
  | 'deleteTrainingPlan'

const writes: Record<WriteKey, number> = {
  createReportRecord: 0,
  updateReportRecord: 0,
  deleteReport: 0,
  createObjective: 0,
  setObjectiveStatus: 0,
  deleteObjective: 0,
  createTrainingPlan: 0,
  setTrainingPlanStatus: 0,
  deleteTrainingPlan: 0,
}
const bump = (key: WriteKey) => {
  writes[key] += 1
}

/** The fetch-then-check single-row reads, counted separately from writes. */
const reads = { getReport: 0, getObjective: 0, getTrainingPlan: 0 }
let storeQueries = 0
/**
 * The opts a list read was handed, and the input a create was handed. Both are
 * reset per iteration below, so the initializers only need a type.
 */
let listOpts: unknown
let createInput: unknown

// The store answers exactly one query on these paths: `visibleStudentIds`'s
// roster lookup, which returns the students on the caller's teams. An org-wide
// caller (owner/admin/analyst/medical) never reaches it — `storeQueries` staying
// at 0 is how the test proves those roles are NOT narrowed.
const fakeDb = (_strings: TemplateStringsArray, ..._values: unknown[]) => {
  storeQueries += 1
  const ids = teamsForCurrentCaller().flatMap((t) => STUDENTS_ON_TEAM[t] ?? [])
  return Promise.resolve(ids.map((id) => ({ id })))
}

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(fakeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(fakeDb),
  orDisabledDefault: (_value: unknown, fallback: unknown) => fallback,
}))

// ── Identity layer ───────────────────────────────────────────────────────────
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
  listMemberTeamIds: async () => teamsForCurrentCaller(),
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

mock.module('../src/lib/notificationEvents', () => ({
  notifyReportReady: () => undefined,
  notifyAttendanceRecorded: () => undefined,
  notifyAnalysisResult: () => undefined,
  notifyAiReportFinished: () => undefined,
  notifyMembershipChanged: () => undefined,
}))

// ── The real write-side predicates, captured after the store stub is in place ──
// The route's fetch-then-check must run the SHIPPED rule, not a copy of it, so
// these two modules are mocked with their real predicates re-exported.
const { objectiveVisibleTo } = await import('../src/lib/org/objectives')
const { planVisibleTo } = await import('../src/lib/org/plans')
const { canSeeStudent } = await import('../src/lib/org/scope')

// ── Data layer ───────────────────────────────────────────────────────────────
const report = (id: string, studentId: string | null) => ({
  id,
  auth0_id: ORG_ID,
  student_id: studentId,
  report_type: 'progress',
  title: `Report ${id.slice(-2)}`,
  period_start: null,
  period_end: null,
  content_json: {},
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  full_name: studentId ? `Player ${studentId.slice(-2)}` : null,
})
const REPORTS = [report(REPORT_A, STUDENT_A), report(REPORT_B, STUDENT_B)]

const objective = (id: string, teamId: string | null, studentId: string | null) => ({
  id,
  org_auth0_id: ORG_ID,
  team_id: teamId,
  student_id: studentId,
  title: `Objective ${id.slice(-2)}`,
  status: 'active',
})
const OBJECTIVES = [
  objective(OBJ_TEAM_A, TEAM_A, null), // team-level: team A's coach owns this
  objective(OBJ_TEAM_B, TEAM_B, null), // team-level, other team
  objective(OBJ_STUDENT_B, null, STUDENT_B), // student-level, other team
]
const plan = (id: string, teamId: string | null, studentId: string | null) => ({
  id,
  org_auth0_id: ORG_ID,
  team_id: teamId,
  student_id: studentId,
  title: `Plan ${id.slice(-2)}`,
  status: 'active',
})
const PLANS = [
  plan(PLAN_TEAM_A, TEAM_A, null), // team-level: team A's coach owns this
  plan(PLAN_TEAM_B, TEAM_B, null), // team-level, other team
  plan(PLAN_STUDENT_B, null, STUDENT_B), // student-level, other team
]

/**
 * Stand-ins for the SQL the data layer emits, driven by the SAME real
 * predicates. `undefined` scope/ids means the route asked for the whole org.
 */
const visibleReports = (opts: { visibleStudentIds?: string[] }) => {
  const ids = opts.visibleStudentIds
  return ids === undefined
    ? REPORTS
    : REPORTS.filter((r) => r.student_id !== null && canSeeStudent(ids, r.student_id))
}
const scopeOf = (s?: { teamIds: string[]; studentIds: string[] }) =>
  s ? { all: false as const, teamIds: s.teamIds } : { all: true as const }
const visibleObjectives = (opts: { scope?: { teamIds: string[]; studentIds: string[] } }) => {
  const scope = opts.scope
  if (scope === undefined) return OBJECTIVES
  return OBJECTIVES.filter((o) => objectiveVisibleTo(scopeOf(scope), scope.studentIds, o))
}
const visiblePlans = (opts: { scope?: { teamIds: string[]; studentIds: string[] } }) => {
  const scope = opts.scope
  if (scope === undefined) return PLANS
  return PLANS.filter((p) => planVisibleTo(scopeOf(scope), scope.studentIds, p))
}

mock.module('../src/lib/orgData', () => ({
  // reports
  listReports: async (_orgAuth0Id: string, opts: { visibleStudentIds?: string[] }) => {
    listOpts = opts
    return visibleReports(opts)
  },
  // The write paths fetch UNSCOPED (opts omitted) so a refusal can be 403 rather
  // than a 404; the read paths pass the scope. Both shapes must be tolerated.
  getReport: async (
    _orgAuth0Id: string,
    id: string,
    opts: { visibleStudentIds?: string[] } = {},
  ) => {
    reads.getReport += 1
    listOpts = opts
    return visibleReports(opts).find((r) => r.id === id) ?? null
  },
  buildReportContent: async () => ({ summary: 'probe' }),
  createReportRecord: async (_orgAuth0Id: string, input: { student_id?: string | null }) => {
    bump('createReportRecord')
    createInput = input
    return report(REPORT_A, input.student_id ?? null)
  },
  updateReportRecord: async (_orgAuth0Id: string, id: string) => {
    bump('updateReportRecord')
    return report(id, STUDENT_A)
  },
  deleteReport: async () => {
    bump('deleteReport')
    return true
  },
  getStudent: async (_orgAuth0Id: string, id: string) => ({
    id,
    full_name: `Player ${id.slice(-2)}`,
    account_auth0_id: null,
    team_id: id === STUDENT_A ? TEAM_A : TEAM_B,
    status: 'active',
  }),
  // objectives
  listObjectives: async (_orgAuth0Id: string, opts: Record<string, unknown>) => {
    listOpts = opts
    return visibleObjectives(opts as Parameters<typeof visibleObjectives>[0])
  },
  createObjective: async (_orgAuth0Id: string, _by: string | null, input: unknown) => {
    bump('createObjective')
    createInput = input
    return objective(OBJ_TEAM_A, TEAM_A, null)
  },
  setObjectiveStatus: async (_orgAuth0Id: string, id: string) => {
    bump('setObjectiveStatus')
    return objective(id, null, null)
  },
  deleteObjective: async () => {
    bump('deleteObjective')
    return true
  },
  // plans
  listTrainingPlans: async (_orgAuth0Id: string, opts: Record<string, unknown>) => {
    listOpts = opts
    return visiblePlans(opts as Parameters<typeof visiblePlans>[0])
  },
  createTrainingPlan: async (_orgAuth0Id: string, _by: string | null, input: unknown) => {
    bump('createTrainingPlan')
    createInput = input
    return plan(PLAN_TEAM_A, TEAM_A, null)
  },
  setTrainingPlanStatus: async (_orgAuth0Id: string, id: string) => {
    bump('setTrainingPlanStatus')
    return plan(id, null, null)
  },
  deleteTrainingPlan: async () => {
    bump('deleteTrainingPlan')
    return true
  },
}))

// The single-row reads the routes import from their own module (the orgData
// barrel is frozen shared surface). Re-export the REAL predicates with them.
mock.module('../src/lib/org/objectives', () => ({
  getObjective: async (_orgAuth0Id: string, id: string) => {
    reads.getObjective += 1
    return OBJECTIVES.find((o) => o.id === id) ?? null
  },
  objectiveVisibleTo,
}))
mock.module('../src/lib/org/plans', () => ({
  getTrainingPlan: async (_orgAuth0Id: string, id: string) => {
    reads.getTrainingPlan += 1
    return PLANS.find((p) => p.id === id) ?? null
  },
  planVisibleTo,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = 'auth0%7Corg-owner'
const reportsRoute = (await import('../src/routes/org/reports')).default
const objectivesRoute = (await import('../src/routes/org/objectives')).default
const plansRoute = (await import('../src/routes/org/plans')).default

type Case = {
  route: 'reports' | 'objectives' | 'plans'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

/** One request per scoped read/write across the three route modules. */
const CASES: Record<string, Case> = {
  // ── reads ─────────────────────────────────────────────────────────────────
  'reports.list': { route: 'reports', method: 'GET', path: `/api/org/${orgPath}/reports` },
  'reports.read.teamB': {
    route: 'reports',
    method: 'GET',
    path: `/api/org/${orgPath}/reports/${REPORT_B}`,
  },
  'objectives.list': { route: 'objectives', method: 'GET', path: `/api/org/${orgPath}/objectives` },
  'objectives.list.filters': {
    route: 'objectives',
    method: 'GET',
    path: `/api/org/${orgPath}/objectives?status=active&team_id=${TEAM_A}`,
  },
  'plans.list': { route: 'plans', method: 'GET', path: `/api/org/${orgPath}/plans` },
  // ── report writes ─────────────────────────────────────────────────────────
  'reports.create.teamB': {
    route: 'reports',
    method: 'POST',
    path: `/api/org/${orgPath}/reports`,
    body: { report_type: 'progress', student_id: STUDENT_B },
  },
  'reports.create.org': {
    route: 'reports',
    method: 'POST',
    path: `/api/org/${orgPath}/reports`,
    body: { report_type: 'monthly' },
  },
  'reports.create.own': {
    route: 'reports',
    method: 'POST',
    path: `/api/org/${orgPath}/reports`,
    body: { report_type: 'progress', student_id: STUDENT_A },
  },
  'reports.update.teamB': {
    route: 'reports',
    method: 'PUT',
    path: `/api/org/${orgPath}/reports/${REPORT_B}`,
    body: { title: 'Hijacked' },
  },
  'reports.delete.teamB': {
    route: 'reports',
    method: 'DELETE',
    path: `/api/org/${orgPath}/reports/${REPORT_B}`,
  },
  // ── objective writes ─────────────────────────────────────────────────────
  'objectives.create.teamB': {
    route: 'objectives',
    method: 'POST',
    path: `/api/org/${orgPath}/objectives`,
    body: { title: 'Sneaky', student_id: STUDENT_B },
  },
  'objectives.create.teamA': {
    route: 'objectives',
    method: 'POST',
    path: `/api/org/${orgPath}/objectives`,
    body: { title: 'Own team', team_id: TEAM_A },
  },
  'objectives.create.org': {
    route: 'objectives',
    method: 'POST',
    path: `/api/org/${orgPath}/objectives`,
    body: { title: 'Org-wide' },
  },
  'objectives.patch.teamB': {
    route: 'objectives',
    method: 'PATCH',
    path: `/api/org/${orgPath}/objectives/${OBJ_TEAM_B}`,
    body: { status: 'done' },
  },
  'objectives.patch.own': {
    route: 'objectives',
    method: 'PATCH',
    path: `/api/org/${orgPath}/objectives/${OBJ_TEAM_A}`,
    body: { status: 'done' },
  },
  'objectives.delete.teamB': {
    route: 'objectives',
    method: 'DELETE',
    path: `/api/org/${orgPath}/objectives/${OBJ_STUDENT_B}`,
  },
  // ── plan writes ───────────────────────────────────────────────────────────
  'plans.create.teamB': {
    route: 'plans',
    method: 'POST',
    path: `/api/org/${orgPath}/plans`,
    body: { title: 'Sneaky', student_id: STUDENT_B },
  },
  'plans.create.teamA': {
    route: 'plans',
    method: 'POST',
    path: `/api/org/${orgPath}/plans`,
    body: { title: 'Own team', team_id: TEAM_A },
  },
  'plans.patch.teamB': {
    route: 'plans',
    method: 'PATCH',
    path: `/api/org/${orgPath}/plans/${PLAN_STUDENT_B}`,
    body: { status: 'done' },
  },
  'plans.delete.teamB': {
    route: 'plans',
    method: 'DELETE',
    path: `/api/org/${orgPath}/plans/${PLAN_TEAM_B}`,
  },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const ROUTES = {
  reports: reportsRoute,
  objectives: objectivesRoute,
  plans: plansRoute,
} as const

const results: Array<{
  role: string
  status: number
  body: unknown
  writes: Record<WriteKey, number>
  reads: typeof reads
  storeQueries: number
  listOpts: unknown
  createInput: unknown
}> = []

for (const token of roleTokens) {
  const isUnassigned = token === UNASSIGNED
  currentRole = (
    token === '__non_member__' ? null : isUnassigned ? 'coach' : token
  ) as OrgMemberRole | null
  currentRoleIsUnassigned = isUnassigned
  for (const key of Object.keys(writes) as WriteKey[]) writes[key] = 0
  reads.getReport = 0
  reads.getObjective = 0
  reads.getTrainingPlan = 0
  storeQueries = 0
  listOpts = null
  createInput = null

  const response = await ROUTES[probe.route].handle(
    new Request(`http://localhost${probe.path}`, {
      method: probe.method,
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(currentRole),
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    }),
  )

  // Parsed from text, not response.json(): a non-JSON body (an Elysia 500) would
  // otherwise be swallowed and the failure would read as "no body".
  const text = await response.text()
  results.push({
    role: token,
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    })(),
    writes: { ...writes },
    reads: { ...reads },
    storeQueries,
    listOpts,
    createInput,
  })
}

console.log(JSON.stringify(results))
