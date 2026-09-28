import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Student-scope probe ───────────────────────────────────────────────────────
// Drives the student-keyed reads and writes in routes/org/students.ts for a
// list of caller roles in a fresh process, printing
// `[{ role, status, writes }]` as the last stdout line. The caller
// (studentScope.test.ts) spawns it once per case so Bun's `mock.module`
// overrides never leak into the rest of the suite's module cache.
//
// The real `resolveCaller`, the real `permissions.ts` matrix and the real
// `lib/org/scope.ts` seam all run. Only the identity layer, the store and the
// data layer are stubbed — the store stub returns the student ids belonging to
// the caller's current team, which is exactly what `visibleStudentIds` reads.

const _ORG_ID = 'auth0|org-owner' // documents the org the stubs answer for
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a2'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b2'
const METRIC_ID = '00000000-0000-0000-0000-0000000000c3'
const JOB_ID = '00000000-0000-0000-0000-0000000000d4'

const roleTokens = (process.env.STUDENT_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
const probeCase = process.env.STUDENT_SCOPE_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('STUDENT_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

// Never the org owner, so resolveCaller must resolve a real membership.
const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// Per-role fixtures: which team the member belongs to, and therefore which
// students `visibleStudentIds` resolves for them.
const TEAM_FOR_ROLE: Partial<Record<OrgMemberRole, string[]>> = {
  head_coach: [TEAM_A],
  coach: [TEAM_A],
  assistant_coach: [TEAM_A],
  analyst: [],
  medical: [],
  player: [],
}
const STUDENTS_ON_TEAM: Record<string, string[]> = {
  [TEAM_A]: [STUDENT_A],
  [TEAM_B]: [STUDENT_B],
}

let currentRole: OrgMemberRole | null = null
const teamsFor = (role: OrgMemberRole | null): string[] => (role ? (TEAM_FOR_ROLE[role] ?? []) : [])

// ── Store spy ────────────────────────────────────────────────────────────────
type WriteKey =
  'updateStudent' | 'deleteStudent' | 'createPerformanceMetric' | 'linkAnalysisToStudent'

const writes: Record<WriteKey, number> = {
  updateStudent: 0,
  deleteStudent: 0,
  createPerformanceMetric: 0,
  linkAnalysisToStudent: 0,
}
const bump = (key: WriteKey) => {
  writes[key] += 1
}

// ── Store: answers the scope seam's one query ────────────────────────────────
// `visibleStudentIds` is the only caller of the store on these paths (getStudent
// and friends are stubbed below), so the tagged template just resolves to the
// students on the caller's teams.
const fakeDb = (_strings: TemplateStringsArray, ..._values: unknown[]) => {
  const ids = teamsFor(currentRole).flatMap((t) => STUDENTS_ON_TEAM[t] ?? [])
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
  listMemberTeamIds: async () => teamsFor(currentRole),
}))

mock.module('../src/lib/analyses', () => ({
  linkAnalysisToStudent: async () => {
    bump('linkAnalysisToStudent')
    return { id: JOB_ID }
  },
  // Read by the job-scoped seam (lib/accountScope), which the students route now
  // reaches. `found: false` makes the seam refuse, and these cases are about the
  // target-student check, which runs first.
  getAnalysisStudentId: async () => ({ found: false, studentId: null }),
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

mock.module('../src/lib/notificationEvents', () => ({
  notifyAnalysisResult: () => undefined,
  notifyReportReady: () => undefined,
  notifyAttendanceRecorded: () => undefined,
  notifyAiReportFinished: () => undefined,
  notifyMembershipChanged: () => undefined,
}))

// ── Data layer ───────────────────────────────────────────────────────────────
const student = (id: string) => ({
  id,
  full_name: `Player ${id.slice(-2)}`,
  account_auth0_id: null,
  team_id: STUDENTS_ON_TEAM[TEAM_A]?.includes(id) ? TEAM_A : TEAM_B,
  status: 'active',
})

mock.module('../src/lib/orgData', () => ({
  listStudents: async () => [student(STUDENT_A), student(STUDENT_B)],
  listStudentSports: async () => [],
  getStudent: async (_orgAuth0Id: string, id: string) => student(id),
  createStudent: async () => student(STUDENT_A),
  updateStudent: async () => {
    bump('updateStudent')
    return student(STUDENT_A)
  },
  deleteStudent: async () => {
    bump('deleteStudent')
    return true
  },
  importStudents: async () => ({ imported: 0, failed: [], duplicates_skipped: 0 }),
  getStudentAnalyses: async () => [{ id: JOB_ID }],
  getStudentPerformanceSeries: async () => [{ metric_key: 'sprint_time' }],
  createPerformanceMetric: async () => {
    bump('createPerformanceMetric')
    return { id: METRIC_ID }
  },
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = 'auth0%7Corg-owner'
const studentsRoute = (await import('../src/routes/org/students')).default

type Case = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

/** Every student-keyed read and write that resolves a single student. */
const CASES: Record<string, Case> = {
  'read.performance': {
    method: 'GET',
    path: `/api/org/${orgPath}/students/${STUDENT_B}/performance`,
  },
  // Same route, but the student IS on the caller's team: the positive half.
  'read.performance.own': {
    method: 'GET',
    path: `/api/org/${orgPath}/students/${STUDENT_A}/performance`,
  },
  'read.analyses': { method: 'GET', path: `/api/org/${orgPath}/students/${STUDENT_B}/analyses` },
  'write.update': {
    method: 'PUT',
    path: `/api/org/${orgPath}/students/${STUDENT_B}`,
    body: { full_name: 'Renamed' },
  },
  'write.delete': { method: 'DELETE', path: `/api/org/${orgPath}/students/${STUDENT_B}` },
  'write.performance': {
    method: 'POST',
    path: `/api/org/${orgPath}/students/${STUDENT_B}/performance`,
    body: { metric_key: 'sprint_time', metric_value: 7 },
  },
  'write.linkAnalysis': {
    method: 'PUT',
    path: `/api/org/${orgPath}/analyses/${JOB_ID}/student`,
    body: { student_id: STUDENT_B },
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
  writes: Record<WriteKey, number>
}> = []

for (const role of roleTokens) {
  currentRole = role
  for (const key of Object.keys(writes) as WriteKey[]) writes[key] = 0

  const response = await studentsRoute.handle(
    new Request(`http://localhost${probe.path}`, {
      method: probe.method,
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(role),
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    }),
  )
  await response.json().catch(() => null)

  results.push({ role, status: response.status, writes: { ...writes } })
}

console.log(JSON.stringify(results))
