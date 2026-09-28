import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org write-guard probe ────────────────────────────────────────────────────
// Drives ONE guarded org write route for a list of caller roles in a fresh
// process with a stubbed store, then prints `[{ role, status, body, writes }]`
// as the last stdout line. The caller (orgWriteGuards.test.ts) spawns it once
// per (route, role-set) case so Bun's `mock.module` overrides never leak into
// the rest of the suite's shared module cache, and the write counters are reset
// between roles.
//
// Only the *identity* layer is stubbed (org_members / teams / notifications /
// audit). The real `resolveCaller` and the real `permissions.ts` matrix run, so
// a passing "allowed" case means the route's own `caller.can(...)` check agreed
// with the documented role → capability table.

const ORG_ID = 'auth0|org-owner'
const STUDENT_ID = '00000000-0000-0000-0000-000000000001'
const REPORT_ID = '00000000-0000-0000-0000-000000000002'
const METRIC_ID = '00000000-0000-0000-0000-000000000003'
const PROBE_TEAM_ID = '00000000-0000-0000-0000-0000000000f1'

const roleTokens = (process.env.ORG_WRITE_GUARD_ROLES ?? '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean)
  .map((token) => (token === '__non_member__' ? null : (token as OrgMemberRole)))
const probeCase = process.env.ORG_WRITE_GUARD_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('ORG_WRITE_GUARD_ROLES must list at least one role')
  process.exit(1)
}

// The member is never the org owner, so `resolveCaller` must actually resolve a
// membership role instead of taking the owner fast-path.
const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// ── Store spy ────────────────────────────────────────────────────────────────
// `writes` counts only mutating data-layer calls; a denied request must leave
// every counter at zero.
type WriteKey =
  | 'createReportRecord'
  | 'updateReportRecord'
  | 'deleteReport'
  | 'createStudent'
  | 'updateStudent'
  | 'deleteStudent'
  | 'importStudents'
  | 'createPerformanceMetric'
  | 'updatePerformanceMetric'
  | 'deletePerformanceMetric'

const writes: Record<WriteKey, number> = {
  createReportRecord: 0,
  updateReportRecord: 0,
  deleteReport: 0,
  createStudent: 0,
  updateStudent: 0,
  deleteStudent: 0,
  importStudents: 0,
  createPerformanceMetric: 0,
  updatePerformanceMetric: 0,
  deletePerformanceMetric: 0,
}

const bump = (key: WriteKey) => {
  writes[key] += 1
}

// ── Identity layer: role + teams ─────────────────────────────────────────────
// `currentRole` is re-pointed per iteration, so the real `resolveCaller` resolves
// a different membership for each caller in the loop at the bottom.
let currentRole: OrgMemberRole | null = null

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
  // Coaching roles are team staff, so the probe gives them a team. With none
  // they would legitimately see no students and every guarded write would be
  // refused on scope — which is correct behaviour, and not what this file
  // tests. It tests the capability floor.
  listMemberTeamIdsInOrg: async (_orgAuth0Id: string) => (currentRole ? [PROBE_TEAM_ID] : []),
}))

// The scope seam resolves visible students through the store. Stub the store
// rather than the seam, so the real `visibleStudentIds` and `canSeeStudent` run
// and these cases test the capability floor against the real policy. (Mocking
// `lib/org/scope` directly does not work here: pre-importing the module to
// reach its pure helpers defeats the override, and the routes keep calling the
// real function.)
const storeDb = () => Promise.resolve([{ id: STUDENT_ID }])
mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(storeDb),
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(storeDb),
  orDisabledDefault: (_value: unknown, fallback: unknown) => fallback,
}))

mock.module('../src/lib/analyses', () => ({
  linkAnalysisToStudent: async () => null,
  // The job-scoped seam (lib/accountScope) reads the analysis's current student
  // through this, and the students route now reaches it, so a partial mock here
  // fails the whole probe process with "Export named ... not found".
  getAnalysisStudentId: async () => ({ found: false, studentId: null }),
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

// ── Data layer: reads return fixtures, writes are counted ────────────────────
const student = {
  id: STUDENT_ID,
  full_name: 'Probe Player',
  account_auth0_id: null,
  team_id: null,
  status: 'active',
}
const report = {
  id: REPORT_ID,
  auth0_id: ORG_ID,
  student_id: STUDENT_ID,
  report_type: 'progress',
  title: 'Probe Report',
  period_start: null,
  period_end: null,
  content_json: {},
  created_at: new Date(0).toISOString(),
}
const metric = {
  id: METRIC_ID,
  auth0_id: ORG_ID,
  student_id: STUDENT_ID,
  metric_key: 'sprint_time',
  metric_value: 7,
  unit: 's',
  measured_at: null,
}

mock.module('../src/lib/orgData', () => ({
  // reports
  listReports: async () => [report],
  getReport: async () => report,
  buildReportContent: async () => ({ summary: 'probe' }),
  createReportRecord: async () => {
    bump('createReportRecord')
    return report
  },
  updateReportRecord: async () => {
    bump('updateReportRecord')
    return report
  },
  deleteReport: async () => {
    bump('deleteReport')
    return true
  },
  // students
  listStudents: async () => [student],
  listStudentSports: async () => [],
  getStudent: async () => student,
  createStudent: async () => {
    bump('createStudent')
    return student
  },
  updateStudent: async () => {
    bump('updateStudent')
    return student
  },
  deleteStudent: async () => {
    bump('deleteStudent')
    return true
  },
  importStudents: async () => {
    bump('importStudents')
    return { imported: 1, failed: [], duplicates_skipped: 0 }
  },
  getStudentAnalyses: async () => [],
  getStudentPerformanceSeries: async () => [],
  // performance
  listPerformance: async () => [metric],
  // The performance write routes resolve the owning student from the metric
  // before mutating, so the scope gate can ask whether that student is visible.
  getPerformanceMetric: async () => metric,
  getStudentTrends: async () => [],
  compareStudents: async () => [],
  createPerformanceMetric: async () => {
    bump('createPerformanceMetric')
    return metric
  },
  updatePerformanceMetric: async () => {
    bump('updatePerformanceMetric')
    return metric
  },
  deletePerformanceMetric: async () => {
    bump('deletePerformanceMetric')
    return true
  },
}))

// Keep the app-level service guard out of this handler-level test: the stubbed
// org_members lookup already supplies the verified member role, so the route's
// own permission guard is the only authorization decision under test.
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = `auth0%7Corg-owner`
const reportsRoute = (await import('../src/routes/org/reports')).default
const studentsRoute = (await import('../src/routes/org/students')).default
const performanceRoute = (await import('../src/routes/org/performance')).default

type Case = {
  route: 'reports' | 'students' | 'performance'
  path: string
  method: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

/** One request per guarded write handler across the three route modules. */
const CASES: Record<string, Case> = {
  'reports.create': {
    route: 'reports',
    path: `/api/org/${orgPath}/reports`,
    method: 'POST',
    body: { report_type: 'progress', student_id: STUDENT_ID },
  },
  'reports.update': {
    route: 'reports',
    path: `/api/org/${orgPath}/reports/${REPORT_ID}`,
    method: 'PUT',
    body: { title: 'Probe Report v2' },
  },
  'reports.delete': {
    route: 'reports',
    path: `/api/org/${orgPath}/reports/${REPORT_ID}`,
    method: 'DELETE',
  },
  'students.create': {
    route: 'students',
    path: `/api/org/${orgPath}/students`,
    method: 'POST',
    body: { full_name: 'Probe Player' },
  },
  'students.update': {
    route: 'students',
    path: `/api/org/${orgPath}/students/${STUDENT_ID}`,
    method: 'PUT',
    body: { full_name: 'Probe Player v2' },
  },
  'students.delete': {
    route: 'students',
    path: `/api/org/${orgPath}/students/${STUDENT_ID}`,
    method: 'DELETE',
  },
  'students.import': {
    route: 'students',
    path: `/api/org/${orgPath}/students/import`,
    method: 'POST',
    body: { rows: [{ full_name: 'Probe Player' }] },
  },
  'students.performance': {
    route: 'students',
    path: `/api/org/${orgPath}/students/${STUDENT_ID}/performance`,
    method: 'POST',
    body: { metric_key: 'sprint_time', metric_value: 7 },
  },
  'performance.update': {
    route: 'performance',
    path: `/api/org/${orgPath}/performance/${METRIC_ID}`,
    method: 'PUT',
    body: { metric_value: 8 },
  },
  'performance.delete': {
    route: 'performance',
    path: `/api/org/${orgPath}/performance/${METRIC_ID}`,
    method: 'DELETE',
  },
}

const ROUTES = {
  reports: reportsRoute,
  students: studentsRoute,
  performance: performanceRoute,
} as const

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const results: Array<{
  role: OrgMemberRole | null
  status: number
  body: unknown
  writes: Record<WriteKey, number>
}> = []

for (const role of roleTokens) {
  currentRole = role
  for (const key of Object.keys(writes) as WriteKey[]) writes[key] = 0

  const response = await ROUTES[probe.route].handle(
    new Request(`http://localhost${probe.path}`, {
      method: probe.method,
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(role),
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    }),
  )

  results.push({
    role,
    status: response.status,
    body: await response.json(),
    writes: { ...writes },
  })
}

console.log(JSON.stringify(results))
