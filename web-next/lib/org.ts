import type { DashboardAnalysis } from './api'
import { mutateJson, pickDefined, queryJson } from './data/client'
import { authUserUrl, emailUrl as coreEmailUrl, orgUrl as coreOrgUrl } from './data/transport'

const org = (auth0Id: string, path: string) => coreOrgUrl(auth0Id, path)

// Email routes live under /api/email/:auth0Id/* (see server/src/routes/email.ts),
// NOT under /api/org/:auth0Id/email/* — keep them on the right namespace.
const email = (auth0Id: string, path: string) => coreEmailUrl(auth0Id, path)

// ── Types ────────────────────────────────────────────────────────────────────

// Org vocabulary — single source of truth for the web app. The server mirrors
// these (same values AND order: order is contractual — see server/src/lib/orgEnums.ts
// and the org *Contract tests on both sides). Add a value there and here.
export const STUDENT_STATUSES = ['active', 'inactive', 'transferred'] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const EVENT_TYPES = ['practice', 'match', 'tournament', 'meeting', 'other'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const REPORT_TYPES = ['progress', 'attendance', 'performance', 'monthly'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

// Human-readable labels — single source of truth for presentation.
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  transferred: 'Transferred',
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  practice: 'Practice',
  match: 'Match',
  tournament: 'Tournament',
  meeting: 'Meeting',
  other: 'Other',
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  progress: 'Progress Report',
  attendance: 'Attendance Report',
  performance: 'Performance Report',
  monthly: 'Monthly Summary',
}

export type Student = {
  id: string
  auth0_id: string
  full_name: string
  email: string | null
  phone: string | null
  sport: string | null
  position: string | null
  jersey_number: number | null
  date_of_birth: string | null
  gender: string | null
  guardian_name: string | null
  guardian_phone: string | null
  notes: string | null
  status: StudentStatus
  joined_on: string | null
  account_auth0_id: string | null
  team_id: string | null
  created_at: string
  updated_at: string
}

export type StudentFormValues = Omit<Student, 'id' | 'auth0_id' | 'created_at' | 'updated_at'>

export type AttendanceRecord = {
  id: string
  student_id: string
  session_date: string
  status: AttendanceStatus
  note: string | null
  created_at: string
  updated_at: string
}

export type AttendanceWithStudent = AttendanceRecord & {
  full_name: string | null
  sport: string | null
}

export type ScheduleEvent = {
  id: string
  event_type: EventType
  title: string
  starts_at: string
  ends_at: string | null
  location: string | null
  description: string | null
  status: EventStatus
  created_at: string
  updated_at: string
}

export type ReportRecord = {
  id: string
  student_id: string | null
  report_type: ReportType
  title: string
  period_start: string | null
  period_end: string | null
  content_json: Record<string, unknown>
  created_at: string
  updated_at: string
  full_name?: string | null
}

export type PerformanceMetric = {
  id: string
  student_id: string
  metric_key: string
  metric_value: number
  unit: string | null
  source_analysis_id: string | null
  measured_at: string
  created_at: string
}

export type PerformanceSeriesPoint = {
  id: string | null
  measured_at: string
  metric_key: string
  metric_value: number
  unit: string | null
  source: 'analysis' | 'manual'
  source_analysis_id: string | null
}

// A row parsed from a CSV roster import. The client parses the CSV; the
// server re-validates each row and reports partial failures.
export type StudentImportRow = {
  full_name?: string
  email?: string
  phone?: string
  sport?: string
  position?: string
  jersey_number?: string | number
  date_of_birth?: string
  gender?: string
  guardian_name?: string
  guardian_phone?: string
  notes?: string
  status?: string
  joined_on?: string
}

export type StudentImportResult = {
  imported: number
  failed: Array<{ row_index: number; reason: string }>
  duplicates_skipped: number
}

export type TrendPoint = {
  measured_at: string
  metric_value: number
  unit: string | null
  source: 'analysis' | 'manual'
}

export type MetricTrend = {
  metric_key: string
  points: TrendPoint[]
  latest: number | null
  avg: number | null
  change: number | null
}

export type ComparisonStudent = {
  student_id: string
  full_name: string
  latest: number | null
  avg: number | null
  points: Array<{ measured_at: string; metric_value: number }>
}

export type ReportContent = {
  generated_at: string
  student: {
    id: string
    full_name: string
    sport: string | null
    position: string | null
    status: string
  } | null
  period: { start: string | null; end: string | null; label: string }
  attendance: {
    total_records: number
    present: number
    absent: number
    late: number
    excused: number
    attendance_rate: number | null
  }
  performance: {
    form_score_avg: number | null
    form_score_latest: number | null
    total_sessions: number
    latest_analysis_at: string | null
  }
  analyses: {
    server_job_id: string
    requested_at: string
    display_name: string | null
    student_id: string | null
    form_score: number | null
  }[]
  summary: string | null
  org: {
    student_count: number
    active_students: number
    sessions_this_month: number
    upcoming_events: number
    analyses_linked: number
    avg_attendance_rate: number | null
  } | null
}

export type AttendanceSummary = {
  total_records: number
  present: number
  absent: number
  late: number
  excused: number
  attendance_rate: number | null
}

export type OrgOverview = {
  student_count: number
  active_students: number
  sessions_this_month: number
  upcoming_events: number
  analyses_linked: number
  avg_attendance_rate: number | null
}

// ── Students ─────────────────────────────────────────────────────────────────

export const orgStudents = async (
  auth0Id: string,
  opts: { search?: string; sport?: string; status?: string } = {},
): Promise<{ students: Student[] }> => {
  const params = new URLSearchParams()
  if (opts.search) params.set('search', opts.search)
  if (opts.sport) params.set('sport', opts.sport)
  if (opts.status) params.set('status', opts.status)
  const qs = params.toString()
  return queryJson<{ students: Student[] }>(org(auth0Id, `/students${qs ? `?${qs}` : ''}`))
}

export const orgStudentsSports = async (auth0Id: string): Promise<{ sports: string[] }> => {
  return queryJson<{ sports: string[] }>(org(auth0Id, '/students/sports'))
}

export const orgStudent = async (auth0Id: string, id: string): Promise<{ student: Student }> => {
  return queryJson<{ student: Student }>(org(auth0Id, `/students/${encodeURIComponent(id)}`))
}

export const orgCreateStudent = async (
  auth0Id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return mutateJson<{ student: Student }>(org(auth0Id, '/students'), 'POST', pickDefined(input))
}

export const orgUpdateStudent = async (
  auth0Id: string,
  id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return mutateJson<{ student: Student }>(
    org(auth0Id, `/students/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}

export const orgDeleteStudent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/students/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgImportStudents = async (
  auth0Id: string,
  rows: StudentImportRow[],
): Promise<StudentImportResult> => {
  return mutateJson<StudentImportResult>(org(auth0Id, '/students/import'), 'POST', { rows })
}

export const orgStudentTrends = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<{ trends: MetricTrend[] }> => {
  const params = new URLSearchParams()
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ trends: MetricTrend[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/trends${qs ? `?${qs}` : ''}`),
  )
}

export const orgCompareStudents = async (
  auth0Id: string,
  ids: string[],
  metricKey?: string,
): Promise<{ comparison: ComparisonStudent[] }> => {
  const qsParts = [`ids=${ids.map(encodeURIComponent).join(',')}`]
  if (metricKey) qsParts.push(`metricKey=${encodeURIComponent(metricKey)}`)
  return queryJson<{ comparison: ComparisonStudent[] }>(
    org(auth0Id, `/students/comparison?${qsParts.join('&')}`),
  )
}

// ── Student detail ───────────────────────────────────────────────────────────

export const orgStudentPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<{ series: PerformanceSeriesPoint[] }> => {
  const params = new URLSearchParams()
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ series: PerformanceSeriesPoint[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/performance${qs ? `?${qs}` : ''}`),
  )
}

export const orgAddPerformanceMetric = async (
  auth0Id: string,
  studentId: string,
  input: { metric_key: string; metric_value: number; unit?: string | null; measured_at?: string },
): Promise<{ metric: PerformanceMetric }> => {
  return mutateJson<{ metric: PerformanceMetric }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/performance`),
    'POST',
    input,
  )
}

export const orgStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
): Promise<{ analyses: DashboardAnalysis[] }> => {
  return queryJson<{ analyses: DashboardAnalysis[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/analyses`),
  )
}

// ── Attendance ───────────────────────────────────────────────────────────────

export const orgAttendance = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<{ records: AttendanceWithStudent[] }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  if (opts.studentId) params.set('studentId', opts.studentId)
  const qs = params.toString()
  return queryJson<{ records: AttendanceWithStudent[] }>(
    org(auth0Id, `/attendance${qs ? `?${qs}` : ''}`),
  )
}

export const orgAttendanceSummary = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<{ summary: AttendanceSummary }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  if (opts.studentId) params.set('studentId', opts.studentId)
  const qs = params.toString()
  return queryJson<{ summary: AttendanceSummary }>(
    org(auth0Id, `/attendance/summary${qs ? `?${qs}` : ''}`),
  )
}

export const orgUpsertAttendance = async (
  auth0Id: string,
  input: { student_id: string; session_date: string; status: AttendanceStatus; note?: string },
): Promise<{ record: AttendanceRecord }> => {
  return mutateJson<{ record: AttendanceRecord }>(org(auth0Id, '/attendance'), 'PUT', input)
}

export const orgBatchAttendance = async (
  auth0Id: string,
  entries: { student_id: string; session_date: string; status: AttendanceStatus; note?: string }[],
): Promise<{ records: AttendanceRecord[]; count: number }> => {
  return mutateJson<{ records: AttendanceRecord[]; count: number }>(
    org(auth0Id, '/attendance/batch'),
    'POST',
    { entries },
  )
}

export const orgDeleteAttendance = async (
  auth0Id: string,
  studentId: string,
  date: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(
      auth0Id,
      `/attendance?studentId=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}`,
    ),
    'DELETE',
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export const orgSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<{ events: ScheduleEvent[] }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ events: ScheduleEvent[] }>(org(auth0Id, `/schedule${qs ? `?${qs}` : ''}`))
}

export const orgCreateEvent = async (
  auth0Id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return mutateJson<{ event: ScheduleEvent }>(org(auth0Id, '/schedule'), 'POST', pickDefined(input))
}

export const orgUpdateEvent = async (
  auth0Id: string,
  id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return mutateJson<{ event: ScheduleEvent }>(
    org(auth0Id, `/schedule/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}

export const orgDeleteEvent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/schedule/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

// ── Reports ──────────────────────────────────────────────────────────────────

export const orgReports = async (
  auth0Id: string,
  opts: { studentId?: string } = {},
): Promise<{ reports: ReportRecord[] }> => {
  const qs = opts.studentId ? `?studentId=${encodeURIComponent(opts.studentId)}` : ''
  return queryJson<{ reports: ReportRecord[] }>(org(auth0Id, `/reports${qs}`))
}

export const orgReport = async (auth0Id: string, id: string): Promise<{ report: ReportRecord }> => {
  return queryJson<{ report: ReportRecord }>(org(auth0Id, `/reports/${encodeURIComponent(id)}`))
}

export const orgCreateReport = async (
  auth0Id: string,
  input: {
    student_id?: string
    report_type: string
    period_start?: string
    period_end?: string
    title?: string
  },
): Promise<{ report: ReportRecord }> => {
  return mutateJson<{ report: ReportRecord }>(org(auth0Id, '/reports'), 'POST', pickDefined(input))
}

export const orgDeleteReport = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/reports/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgUpdateReport = async (
  auth0Id: string,
  id: string,
  input: {
    report_type?: string
    period_start?: string | null
    period_end?: string | null
    title?: string
  },
): Promise<{ report: ReportRecord }> => {
  return mutateJson<{ report: ReportRecord }>(
    org(auth0Id, `/reports/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}

// ── Training objectives (§26 loop) ──────────────────────────────────────────
export type TrainingObjective = {
  id: string
  org_auth0_id: string
  student_id: string | null
  team_id: string | null
  finding_id: string | null
  analysis_job_id: string | null
  title: string
  description: string | null
  status: 'active' | 'done' | 'archived'
  due_on: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const orgObjectives = async (
  auth0Id: string,
  opts: { studentId?: string; teamId?: string; status?: string } = {},
): Promise<{ objectives: TrainingObjective[] }> => {
  const params = new URLSearchParams()
  if (opts.studentId) params.set('student_id', opts.studentId)
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.status) params.set('status', opts.status)
  const qs = params.toString()
  return queryJson<{ objectives: TrainingObjective[] }>(
    org(auth0Id, `/objectives${qs ? `?${qs}` : ''}`),
  )
}

export const orgCreateObjective = async (
  auth0Id: string,
  input: {
    student_id?: string | null
    team_id?: string | null
    finding_id?: string | null
    analysis_job_id?: string | null
    title: string
    description?: string | null
    due_on?: string | null
  },
): Promise<{ objective: TrainingObjective }> => {
  return mutateJson<{ objective: TrainingObjective }>(
    org(auth0Id, '/objectives'),
    'POST',
    pickDefined(input),
  )
}

export const orgSetObjectiveStatus = async (
  auth0Id: string,
  id: string,
  status: 'active' | 'done' | 'archived',
): Promise<{ objective: TrainingObjective }> => {
  return mutateJson<{ objective: TrainingObjective }>(
    org(auth0Id, `/objectives/${encodeURIComponent(id)}`),
    'PATCH',
    { status },
  )
}

export const orgDeleteObjective = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/objectives/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export type StoredFinding = {
  id: string
  server_job_id: string
  category: string | null
  start_ms: number | null
  end_ms: number | null
  confidence: number | null
  confidence_band: string | null
  severity: string | null
  observation: string | null
  feedback: string | null
  form_score: number | null
  evidence_frames: unknown
  measured_at_timestamp: number | null
  model_versions: unknown
  review_state: string
  created_at: string
}

export const orgStudentFindings = async (
  auth0Id: string,
  studentId: string,
  limit = 20,
): Promise<{ findings: StoredFinding[] }> => {
  const params = new URLSearchParams({ student_id: studentId, limit: String(limit) })
  return queryJson<{ findings: StoredFinding[] }>(
    authUserUrl(auth0Id, `/findings?${params.toString()}`),
  )
}

/** Export URL for a student's findings CSV (server-serialized, BOM-prefixed). */
export const studentFindingsExportUrl = (auth0Id: string, studentId: string, limit = 200) => {
  const params = new URLSearchParams({ student_id: studentId, limit: String(limit) })
  return authUserUrl(auth0Id, `/findings/export?${params.toString()}`)
}

/**
 * Downloads a student's findings as CSV through the identity proxy (session
 * headers are injected there, so no manual auth wiring). Client-only: creates
 * a blob download named findings-<studentId>.csv.
 */
export const downloadStudentFindingsCsv = async (
  auth0Id: string,
  studentId: string,
): Promise<void> => {
  const res = await fetch(studentFindingsExportUrl(auth0Id, studentId), {
    headers: { 'x-request-id': crypto.randomUUID() },
  })
  if (!res.ok) {
    let message = `Export failed (${res.status})`
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      // non-JSON error — keep the status message
    }
    throw new Error(message)
  }
  const text = await res.text()
  const url = window.URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `findings-${studentId}.csv`
  a.click()
  window.URL.revokeObjectURL(url)
}

// ── Seasons & matches ──────────────────────────────────────────────────────

export type Season = {
  id: string
  org_auth0_id: string
  name: string
  starts_on: string | null
  ends_on: string | null
  created_at: string
}

export type Match = {
  id: string
  org_auth0_id: string
  team_id: string | null
  season_id: string | null
  opponent: string | null
  match_on: string | null
  location: string | null
  result: string | null
  created_at: string
}

export const orgSeasons = async (auth0Id: string): Promise<{ seasons: Season[] }> =>
  queryJson<{ seasons: Season[] }>(org(auth0Id, '/seasons'))

export const orgCreateSeason = async (
  auth0Id: string,
  input: { name: string; starts_on?: string | null; ends_on?: string | null },
): Promise<{ season: Season }> =>
  mutateJson<{ season: Season }>(org(auth0Id, '/seasons'), 'POST', pickDefined(input))

export const orgDeleteSeason = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(org(auth0Id, `/seasons/${encodeURIComponent(id)}`), 'DELETE')

export const orgMatches = async (
  auth0Id: string,
  opts: { teamId?: string | null; seasonId?: string | null } = {},
): Promise<{ matches: Match[] }> => {
  const params = new URLSearchParams()
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.seasonId) params.set('season_id', opts.seasonId)
  const qs = params.toString()
  return queryJson<{ matches: Match[] }>(org(auth0Id, `/matches${qs ? `?${qs}` : ''}`))
}

export const orgCreateMatch = async (
  auth0Id: string,
  input: {
    team_id?: string | null
    season_id?: string | null
    opponent?: string | null
    match_on?: string | null
    location?: string | null
    result?: string | null
  },
): Promise<{ match: Match }> =>
  mutateJson<{ match: Match }>(org(auth0Id, '/matches'), 'POST', pickDefined(input))

export const orgDeleteMatch = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(org(auth0Id, `/matches/${encodeURIComponent(id)}`), 'DELETE')

// ── Training plans ─────────────────────────────────────────────────────────

export type TrainingPlan = {
  id: string
  org_auth0_id: string
  team_id: string | null
  student_id: string | null
  title: string
  description: string | null
  status: 'active' | 'done' | 'archived'
  created_by: string | null
  created_at: string
  updated_at: string
}

export const orgPlans = async (
  auth0Id: string,
  opts: { teamId?: string | null; studentId?: string | null } = {},
): Promise<{ plans: TrainingPlan[] }> => {
  const params = new URLSearchParams()
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.studentId) params.set('student_id', opts.studentId)
  const qs = params.toString()
  return queryJson<{ plans: TrainingPlan[] }>(org(auth0Id, `/plans${qs ? `?${qs}` : ''}`))
}

export const orgCreatePlan = async (
  auth0Id: string,
  input: {
    team_id?: string | null
    student_id?: string | null
    title: string
    description?: string | null
  },
): Promise<{ plan: TrainingPlan }> =>
  mutateJson<{ plan: TrainingPlan }>(org(auth0Id, '/plans'), 'POST', pickDefined(input))

export const orgSetPlanStatus = async (
  auth0Id: string,
  id: string,
  status: 'active' | 'done' | 'archived',
): Promise<{ plan: TrainingPlan }> =>
  mutateJson<{ plan: TrainingPlan }>(org(auth0Id, `/plans/${encodeURIComponent(id)}`), 'PATCH', {
    status,
  })

export const orgDeletePlan = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(org(auth0Id, `/plans/${encodeURIComponent(id)}`), 'DELETE')

// ── Wellness check-ins (health data, §5 — medical permission to read) ──────

export type WellnessCheckin = {
  id: string
  org_auth0_id: string
  student_id: string
  sleep_hours: number | null
  fatigue: number | null
  pain: string | null
  availability: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export const orgWellness = async (
  auth0Id: string,
  studentId: string,
): Promise<{ checkins: WellnessCheckin[] }> =>
  queryJson<{ checkins: WellnessCheckin[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/wellness`),
  )

export const orgCreateWellness = async (
  auth0Id: string,
  studentId: string,
  input: {
    sleep_hours?: number | null
    fatigue?: number | null
    pain?: string | null
    availability?: string | null
    note?: string | null
  },
): Promise<{ checkin: WellnessCheckin }> =>
  mutateJson<{ checkin: WellnessCheckin }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/wellness`),
    'POST',
    pickDefined(input),
  )

// ── Subscription & usage ───────────────────────────────────────────────────

export type OrgSubscription = {
  subscription: { tier: string; status: string }
  usage_today: Record<string, number>
  daily_analysis_limit: number
}

export const orgSubscription = async (auth0Id: string): Promise<OrgSubscription> =>
  queryJson<OrgSubscription>(org(auth0Id, '/subscription'))

// ── Performance metrics ──────────────────────────────────────────────────────

export const orgPerformanceMetrics = async (
  auth0Id: string,
  opts: { studentId: string; metricKey?: string; from?: string; to?: string },
): Promise<{ metrics: PerformanceMetric[] }> => {
  const params = new URLSearchParams({ studentId: opts.studentId })
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  return queryJson<{ metrics: PerformanceMetric[] }>(
    org(auth0Id, `/performance?${params.toString()}`),
  )
}

export const orgDeletePerformanceMetric = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/performance/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgUpdatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<{ metric: PerformanceMetric }> => {
  return mutateJson<{ metric: PerformanceMetric }>(
    org(auth0Id, `/performance/${encodeURIComponent(id)}`),
    'PUT',
    input,
  )
}

// ── Overview & analysis linking ──────────────────────────────────────────────

export const orgOverview = async (auth0Id: string): Promise<{ overview: OrgOverview }> => {
  return queryJson<{ overview: OrgOverview }>(org(auth0Id, '/overview'))
}

// ── Global search ────────────────────────────────────────────────────────────

export type SearchItem = {
  id: string
  label: string
  subtitle: string | null
}

export type OrgSearchResult = {
  students: SearchItem[]
  schedule: SearchItem[]
  reports: SearchItem[]
  analyses: SearchItem[]
}

export const orgSearch = async (auth0Id: string, query: string): Promise<OrgSearchResult> => {
  return queryJson<OrgSearchResult>(org(auth0Id, `/search?q=${encodeURIComponent(query)}`))
}

// ── Email (Resend) ───────────────────────────────────────────────────────────

export type EmailSendOutcome = {
  to: string
  ok: boolean
}

export const orgSendInvites = async (
  auth0Id: string,
  input: { emails: string[]; student_ids?: string[] },
): Promise<{ sent: EmailSendOutcome[]; total: number; failed: number }> => {
  return mutateJson<{ sent: EmailSendOutcome[]; total: number; failed: number }>(
    email(auth0Id, '/invite'),
    'POST',
    input,
  )
}

export const orgEmailReport = async (
  auth0Id: string,
  input: { report_id: string; to?: string },
): Promise<{ sent: { id: string | null; to: string; subject: string } }> => {
  return mutateJson<{ sent: { id: string | null; to: string; subject: string } }>(
    email(auth0Id, '/report'),
    'POST',
    input,
  )
}

export const orgEmailAttendance = async (
  auth0Id: string,
  input: { student_id?: string; from?: string; to?: string; recipient?: string },
): Promise<{ sent: unknown; records: number }> => {
  return mutateJson<{ sent: unknown; records: number }>(
    email(auth0Id, '/attendance'),
    'POST',
    input,
  )
}

export const linkAnalysisToStudent = async (
  auth0Id: string,
  jobId: string,
  studentId: string | null,
): Promise<{ analysis: DashboardAnalysis }> => {
  return mutateJson<{ analysis: DashboardAnalysis }>(
    org(auth0Id, `/analyses/${encodeURIComponent(jobId)}/student`),
    'PUT',
    { student_id: studentId },
  )
}
