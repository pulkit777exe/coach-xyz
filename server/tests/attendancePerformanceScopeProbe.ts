import { mock } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import type { OrgMemberRole } from '../src/lib/orgMembers'
import { MAX_ATTENDANCE_BATCH } from '../src/lib/orgValidate'

// ── Team-scope probe: attendance + performance ───────────────────────────────
// Drives ONE attendance/performance route for one (role, teams, target student)
// triple in a fresh process, then prints a single JSON line for
// attendancePerformanceScope.test.ts.
//
// What is REAL here: `resolveCaller`, `lib/permissions.ts` (the role →
// capability table and `resolveStudentScope`), and `lib/org/scope.ts`
// (`visibleStudentIds` / `canSeeStudent`) — the scope ids come from the stub
// store's roster, not from a hard-coded list. So an "allowed" case proves the
// route's own check agreed with the policy rather than with a stub.
//
// What is stubbed: the identity lookups (org_members / teams), the org data
// barrel, and the attendance notification fan-out. Every data call is counted;
// reads record the `studentIds` filter they were handed, writes only count.

const ORG = 'auth0|org-owner'
const TEAM_A = '00000000-0000-4000-8000-00000000000a'
const TEAM_B = '00000000-0000-4000-8000-00000000000b'
const STUDENT_A = '00000000-0000-4000-8000-0000000000a1'
const STUDENT_B = '00000000-0000-4000-8000-0000000000b1'
const METRIC_A = '00000000-0000-4000-8000-0000000000c1'
const METRIC_B = '00000000-0000-4000-8000-0000000000c2'
const SESSION_DATE = '2026-03-02'

const ROSTER = [
  { id: STUDENT_A, team_id: TEAM_A, full_name: 'Team A Player' },
  { id: STUDENT_B, team_id: TEAM_B, full_name: 'Team B Player' },
]

const roleToken = process.env.ATT_PERF_SCOPE_ROLE ?? ''
const role: OrgMemberRole | null =
  roleToken === '__non_member__' ? null : (roleToken as OrgMemberRole)
const callerTeams = (process.env.ATT_PERF_SCOPE_TEAMS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
const target = process.env.ATT_PERF_SCOPE_TARGET === 'teamB' ? 'teamB' : 'teamA'
const probeCase = process.env.ATT_PERF_SCOPE_CASE ?? ''

const memberId = role ? `auth0|${role}-member` : 'auth0|outsider'
const targetStudentId = target === 'teamA' ? STUDENT_A : STUDENT_B
const targetMetricId = target === 'teamA' ? METRIC_A : METRIC_B

// ── Store stub ───────────────────────────────────────────────────────────────
// Answers exactly one query shape: the scope seam's `select id from students
// where auth0_id = … and team_id = any(…)`. Everything else (DDL) returns [].
const scopeLookups: Array<{ auth0Id: string; teamIds: string[] }> = []

/** Team ids arrive as the `uuidArrayLiteral` text form (`{a}` / `{a,b}`) from scope.ts. */
const teamIdsFrom = (value: unknown): string[] => {
  if (Array.isArray(value)) return value as string[]
  if (typeof value !== 'string') return []
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join(' ')
  if (/from\s+students/i.test(sql) && /team_id\s*=\s*any/i.test(sql)) {
    const auth0Id = String(values[0] ?? '')
    const bound = values.find(
      (v) => Array.isArray(v) || (typeof v === 'string' && /^\{.*\}$/.test(v)),
    )
    const teamIds = teamIdsFrom(bound)
    scopeLookups.push({ auth0Id, teamIds })
    return ROSTER.filter((s) => teamIds.includes(s.team_id)).map((s) => ({ id: s.id }))
  }
  return []
}) as unknown as SQL

const store = Object.assign(tag, {
  connect: async () => {},
  unsafe: async () => [],
  close: async () => {},
}) as unknown as SQL
setHistoryStoreConnectionForTests(store)

// ── Call counters ────────────────────────────────────────────────────────────
type CallKey =
  | 'listAttendance'
  | 'attendanceSummary'
  | 'upsertAttendance'
  | 'setAttendanceBatch'
  | 'deleteAttendance'
  | 'notifyAttendanceRecorded'
  | 'getStudent'
  | 'listPerformance'
  | 'getStudentTrends'
  | 'compareStudents'
  | 'getPerformanceMetric'
  | 'updatePerformanceMetric'
  | 'deletePerformanceMetric'

const calls: Record<CallKey, number> = {
  listAttendance: 0,
  attendanceSummary: 0,
  upsertAttendance: 0,
  setAttendanceBatch: 0,
  deleteAttendance: 0,
  notifyAttendanceRecorded: 0,
  getStudent: 0,
  listPerformance: 0,
  getStudentTrends: 0,
  compareStudents: 0,
  getPerformanceMetric: 0,
  updatePerformanceMetric: 0,
  deletePerformanceMetric: 0,
}
const bump = (key: CallKey) => {
  calls[key] += 1
}

/** What each student-keyed read was asked to narrow to (null = org-wide). */
const filters: Record<string, string[] | null> = {}
type ScopedOpts = { studentIds?: string[] | null }
const record = (key: string, ids: string[] | null | undefined) => {
  filters[key] = ids === undefined ? null : ids
}
/** Stand-in for the SQL filter: `null`/absent means the whole org is visible. */
const narrow = <T extends { student_id: string }>(
  rows: T[],
  ids: string[] | null | undefined,
): T[] =>
  ids === undefined || ids === null ? rows : rows.filter((r) => ids.includes(r.student_id))
const byStudent = <T extends { student_id: string }>(rows: T[], studentId?: string): T[] =>
  !studentId ? rows : rows.filter((r) => r.student_id === studentId)

// ── Fixtures ─────────────────────────────────────────────────────────────────
const attendanceRow = (studentId: string) => ({
  id: `att-${studentId}`,
  auth0_id: ORG,
  student_id: studentId,
  session_date: SESSION_DATE,
  status: 'present',
  note: null,
  created_at: '2026-03-02T00:00:00.000Z',
  updated_at: '2026-03-02T00:00:00.000Z',
  full_name: ROSTER.find((s) => s.id === studentId)?.full_name ?? 'Unknown',
  sport: 'soccer',
})
const attendanceRows = ROSTER.map((s) => attendanceRow(s.id))

const metricRow = (id: string, studentId: string) => ({
  id,
  auth0_id: ORG,
  student_id: studentId,
  metric_key: 'sprint_time',
  metric_value: 7,
  unit: 's',
  source_analysis_id: null,
  measured_at: '2026-03-01T00:00:00.000Z',
  created_at: '2026-03-01T00:00:00.000Z',
})
const metrics = [metricRow(METRIC_A, STUDENT_A), metricRow(METRIC_B, STUDENT_B)]

const studentRow = (id: string) => {
  const found = ROSTER.find((s) => s.id === id)
  if (!found) return null
  return {
    id: found.id,
    auth0_id: ORG,
    full_name: found.full_name,
    account_auth0_id: null,
    team_id: found.team_id,
    status: 'active',
  }
}

const trendFor = (studentId: string) => ({
  metric_key: 'sprint_time',
  latest: 7,
  avg: 7,
  change: 0,
  direction: 'flat' as const,
  points: [{ measured_at: '2026-03-01T00:00:00.000Z', metric_value: 7 }],
  student_id: studentId,
})

// ── Identity layer: role + team memberships (the real policy reads these) ────
mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberId ? role : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
  listMemberTeamIdsInOrg: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberId ? callerTeams : [],
}))

mock.module('../src/lib/notificationEvents', () => ({
  notifyAttendanceRecorded: async () => {
    bump('notifyAttendanceRecorded')
  },
  notifyReportReady: () => undefined,
  notifyAnalysisResult: () => undefined,
  notifyAiReportFinished: () => undefined,
  notifyMembershipChanged: () => undefined,
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

// ── Data layer: reads honour the filter they were handed, writes only count ──
type AttendanceOpts = ScopedOpts & { studentId?: string }

const attendance = {
  listAttendance: async (_auth0Id: string, opts: AttendanceOpts = {}) => {
    bump('listAttendance')
    record('listAttendance', opts.studentIds)
    return narrow(byStudent(attendanceRows, opts.studentId), opts.studentIds)
  },
  attendanceSummary: async (_auth0Id: string, opts: AttendanceOpts = {}) => {
    bump('attendanceSummary')
    record('attendanceSummary', opts.studentIds)
    const rows = narrow(byStudent(attendanceRows, opts.studentId), opts.studentIds)
    return {
      total_records: rows.length,
      present: rows.filter((r) => r.status === 'present').length,
      absent: 0,
      late: 0,
      excused: 0,
      attendance_rate: rows.length === 0 ? null : 100,
    }
  },
  upsertAttendance: async (
    _auth0Id: string,
    studentId: string,
    sessionDate: string,
    status: string,
    note?: string | null,
  ) => {
    bump('upsertAttendance')
    return { ...attendanceRow(studentId), status, note: note ?? null }
  },
  setAttendanceBatch: async (
    _auth0Id: string,
    entries: Array<{ studentId: string; sessionDate: string; status: string }>,
  ) => {
    bump('setAttendanceBatch')
    return entries.map((e) => attendanceRow(e.studentId))
  },
  deleteAttendance: async (_auth0Id: string, studentId: string, sessionDate: string) => {
    bump('deleteAttendance')
    return !!attendanceRows.find(
      (r) => r.student_id === studentId && r.session_date === sessionDate,
    )
  },
  getStudent: async (_auth0Id: string, id: string) => {
    bump('getStudent')
    return studentRow(id)
  },
  getStudentsByIds: async (_auth0Id: string, ids: readonly string[]) => {
    bump('getStudentsByIds')
    return ids.map((id) => studentRow(id)).filter((s) => s !== null)
  },
  listPerformance: async (_auth0Id: string, studentId: string, opts: ScopedOpts = {}) => {
    bump('listPerformance')
    record('listPerformance', opts.studentIds)
    return narrow(byStudent(metrics, studentId), opts.studentIds)
  },
  getStudentPerformanceSeries: async () => [],
  getStudentTrends: async (_auth0Id: string, studentId: string, opts: ScopedOpts = {}) => {
    bump('getStudentTrends')
    record('getStudentTrends', opts.studentIds)
    // An out-of-scope student produces no series, so no trend line.
    return narrow([trendFor(studentId)], opts.studentIds)
  },
  compareStudents: async (_auth0Id: string, studentIds: string[]) => {
    bump('compareStudents')
    return studentIds.map((id) => ({
      student_id: id,
      full_name: ROSTER.find((s) => s.id === id)?.full_name ?? 'Unknown',
      latest: 7,
      avg: 7,
      points: [{ measured_at: '2026-03-01T00:00:00.000Z', metric_value: 7 }],
    }))
  },
  // Imported directly by the performance route (not via the orgData barrel).
  getPerformanceMetric: async (_auth0Id: string, id: string) => {
    bump('getPerformanceMetric')
    return metrics.find((m) => m.id === id) ?? null
  },
  updatePerformanceMetric: async (
    _auth0Id: string,
    id: string,
    input: { metric_value: number },
  ) => {
    bump('updatePerformanceMetric')
    const found = metrics.find((m) => m.id === id)
    return found ? { ...found, metric_value: input.metric_value } : null
  },
  deletePerformanceMetric: async (_auth0Id: string, id: string) => {
    bump('deletePerformanceMetric')
    return metrics.some((m) => m.id === id)
  },
  createPerformanceMetric: async () => null,
}

mock.module('../src/lib/orgData', () => attendance)
mock.module('../src/lib/org/performance', () => attendance)

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = encodeURIComponent(ORG)
const attendanceRoute = (await import('../src/routes/org/attendance')).default
const performanceRoute = (await import('../src/routes/org/performance')).default

type Case = {
  route: 'attendance' | 'performance'
  path: string
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  body?: unknown
}

const CASES: Record<string, Case> = {
  'attendance.list': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance`,
    method: 'GET',
  },
  'attendance.summary': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance/summary`,
    method: 'GET',
  },
  'attendance.put': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance`,
    method: 'PUT',
    body: { student_id: targetStudentId, session_date: SESSION_DATE, status: 'present' },
  },
  'attendance.batch': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance/batch`,
    method: 'POST',
    body: {
      entries: [{ student_id: targetStudentId, session_date: SESSION_DATE, status: 'late' }],
    },
  },
  // One entry over the cap. Every entry is individually well-formed and the
  // target student IS in scope, so the only thing that can reject this is the
  // size check — and `calls.setAttendanceBatch` must stay 0, which is the
  // assertion that matters: the cap has to fire *before* the sequential upsert
  // loop, not after it has already done 501 round trips.
  'attendance.batchOverCap': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance/batch`,
    method: 'POST',
    body: {
      entries: Array.from({ length: MAX_ATTENDANCE_BATCH + 1 }, () => ({
        student_id: targetStudentId,
        session_date: SESSION_DATE,
        status: 'late',
      })),
    },
  },
  // The boundary itself: exactly at the cap is still accepted, so the check is
  // `>` and not `>=`. Paired with batchOverCap so a one-off cannot pass both.
  'attendance.batchAtCap': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance/batch`,
    method: 'POST',
    body: {
      entries: Array.from({ length: MAX_ATTENDANCE_BATCH }, () => ({
        student_id: targetStudentId,
        session_date: SESSION_DATE,
        status: 'late',
      })),
    },
  },
  'attendance.delete': {
    route: 'attendance',
    path: `/api/org/${orgPath}/attendance?studentId=${targetStudentId}&date=${SESSION_DATE}`,
    method: 'DELETE',
  },
  'performance.list': {
    route: 'performance',
    path: `/api/org/${orgPath}/performance?studentId=${targetStudentId}`,
    method: 'GET',
  },
  'performance.trends': {
    route: 'performance',
    path: `/api/org/${orgPath}/students/${targetStudentId}/trends`,
    method: 'GET',
  },
  'performance.comparison': {
    route: 'performance',
    path: `/api/org/${orgPath}/students/comparison?ids=${STUDENT_A},${STUDENT_B}`,
    method: 'GET',
  },
  'performance.update': {
    route: 'performance',
    path: `/api/org/${orgPath}/performance/${targetMetricId}`,
    method: 'PUT',
    body: { metric_value: 9 },
  },
  'performance.delete': {
    route: 'performance',
    path: `/api/org/${orgPath}/performance/${targetMetricId}`,
    method: 'DELETE',
  },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const ROUTES = { attendance: attendanceRoute, performance: performanceRoute } as const
const response = await ROUTES[probe.route].handle(
  new Request(`http://localhost${probe.path}`, {
    method: probe.method,
    headers: {
      'content-type': 'application/json',
      'x-verified-auth0-id': memberId,
    },
    ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
  }),
)

console.log(
  JSON.stringify({
    case: probeCase,
    role,
    teams: callerTeams,
    target,
    status: response.status,
    body: await response.json(),
    filters,
    calls,
    scopeLookups,
  }),
)
