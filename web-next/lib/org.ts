import { apiFetch } from "./api"
import type { DashboardAnalysis } from "./api"

const BASE = process.env.NEXT_PUBLIC_API_URL

const org = (auth0Id: string, path: string) =>
  `${BASE}/api/org/${encodeURIComponent(auth0Id)}${path}`

// ── Types ────────────────────────────────────────────────────────────────────

// Org vocabulary — single source of truth for the web app. The server mirrors
// these in server/src/lib/orgEnums.ts; add a value there and here.
export const STUDENT_STATUSES = ["active", "inactive", "transferred"] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const EVENT_TYPES = ["practice", "match", "tournament", "meeting", "other"] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = ["scheduled", "completed", "cancelled"] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const REPORT_TYPES = ["progress", "attendance", "performance", "monthly"] as const
export type ReportType = (typeof REPORT_TYPES)[number]

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
  created_at: string
  updated_at: string
}

export type StudentFormValues = Omit<
  Student,
  "id" | "auth0_id" | "created_at" | "updated_at"
>

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
  source: "analysis" | "manual"
  source_analysis_id: string | null
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
  if (opts.search) params.set("search", opts.search)
  if (opts.sport) params.set("sport", opts.sport)
  if (opts.status) params.set("status", opts.status)
  const qs = params.toString()
  return apiFetch<{ students: Student[] }>(org(auth0Id, `/students${qs ? `?${qs}` : ""}`))
}

export const orgStudentsSports = async (
  auth0Id: string,
): Promise<{ sports: string[] }> => {
  return apiFetch<{ sports: string[] }>(org(auth0Id, "/students/sports"))
}

export const orgStudent = async (
  auth0Id: string,
  id: string,
): Promise<{ student: Student }> => {
  return apiFetch<{ student: Student }>(org(auth0Id, `/students/${encodeURIComponent(id)}`))
}

export const orgCreateStudent = async (
  auth0Id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return apiFetch<{ student: Student }>(org(auth0Id, "/students"), {
    method: "POST",
    body: JSON.stringify(pickDefined(input)),
  })
}

export const orgUpdateStudent = async (
  auth0Id: string,
  id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return apiFetch<{ student: Student }>(
    org(auth0Id, `/students/${encodeURIComponent(id)}`),
    {
      method: "PUT",
      body: JSON.stringify(pickDefined(input)),
    },
  )
}

export const orgDeleteStudent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(
    org(auth0Id, `/students/${encodeURIComponent(id)}`),
    { method: "DELETE" },
  )
}

// ── Student detail ───────────────────────────────────────────────────────────

export const orgStudentPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<{ series: PerformanceSeriesPoint[] }> => {
  const params = new URLSearchParams()
  if (opts.metricKey) params.set("metricKey", opts.metricKey)
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)
  const qs = params.toString()
  return apiFetch<{ series: PerformanceSeriesPoint[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/performance${qs ? `?${qs}` : ""}`),
  )
}

export const orgAddPerformanceMetric = async (
  auth0Id: string,
  studentId: string,
  input: { metric_key: string; metric_value: number; unit?: string | null; measured_at?: string },
): Promise<{ metric: PerformanceMetric }> => {
  return apiFetch<{ metric: PerformanceMetric }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/performance`),
    { method: "POST", body: JSON.stringify(input) },
  )
}

export const orgStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
): Promise<{ analyses: DashboardAnalysis[] }> => {
  return apiFetch<{ analyses: DashboardAnalysis[] }>(
    org(auth0Id, `/students/${encodeURIComponent(studentId)}/analyses`),
  )
}

// ── Attendance ───────────────────────────────────────────────────────────────

export const orgAttendance = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<{ records: AttendanceWithStudent[] }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)
  if (opts.studentId) params.set("studentId", opts.studentId)
  const qs = params.toString()
  return apiFetch<{ records: AttendanceWithStudent[] }>(
    org(auth0Id, `/attendance${qs ? `?${qs}` : ""}`),
  )
}

export const orgAttendanceSummary = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<{ summary: AttendanceSummary }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)
  if (opts.studentId) params.set("studentId", opts.studentId)
  const qs = params.toString()
  return apiFetch<{ summary: AttendanceSummary }>(
    org(auth0Id, `/attendance/summary${qs ? `?${qs}` : ""}`),
  )
}

export const orgUpsertAttendance = async (
  auth0Id: string,
  input: { student_id: string; session_date: string; status: AttendanceStatus; note?: string },
): Promise<{ record: AttendanceRecord }> => {
  return apiFetch<{ record: AttendanceRecord }>(org(auth0Id, "/attendance"), {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export const orgBatchAttendance = async (
  auth0Id: string,
  entries: { student_id: string; session_date: string; status: AttendanceStatus; note?: string }[],
): Promise<{ records: AttendanceRecord[]; count: number }> => {
  return apiFetch<{ records: AttendanceRecord[]; count: number }>(
    org(auth0Id, "/attendance/batch"),
    { method: "POST", body: JSON.stringify({ entries }) },
  )
}

export const orgDeleteAttendance = async (
  auth0Id: string,
  studentId: string,
  date: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(
    org(auth0Id, `/attendance?studentId=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}`),
    { method: "DELETE" },
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export const orgSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<{ events: ScheduleEvent[] }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)
  const qs = params.toString()
  return apiFetch<{ events: ScheduleEvent[] }>(org(auth0Id, `/schedule${qs ? `?${qs}` : ""}`))
}

export const orgCreateEvent = async (
  auth0Id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return apiFetch<{ event: ScheduleEvent }>(org(auth0Id, "/schedule"), {
    method: "POST",
    body: JSON.stringify(pickDefined(input)),
  })
}

export const orgUpdateEvent = async (
  auth0Id: string,
  id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return apiFetch<{ event: ScheduleEvent }>(
    org(auth0Id, `/schedule/${encodeURIComponent(id)}`),
    { method: "PUT", body: JSON.stringify(pickDefined(input)) },
  )
}

export const orgDeleteEvent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(org(auth0Id, `/schedule/${encodeURIComponent(id)}`), {
    method: "DELETE",
  })
}

// ── Reports ──────────────────────────────────────────────────────────────────

export const orgReports = async (
  auth0Id: string,
  opts: { studentId?: string } = {},
): Promise<{ reports: ReportRecord[] }> => {
  const qs = opts.studentId ? `?studentId=${encodeURIComponent(opts.studentId)}` : ""
  return apiFetch<{ reports: ReportRecord[] }>(org(auth0Id, `/reports${qs}`))
}

export const orgReport = async (
  auth0Id: string,
  id: string,
): Promise<{ report: ReportRecord }> => {
  return apiFetch<{ report: ReportRecord }>(org(auth0Id, `/reports/${encodeURIComponent(id)}`))
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
  return apiFetch<{ report: ReportRecord }>(org(auth0Id, "/reports"), {
    method: "POST",
    body: JSON.stringify(pickDefined(input)),
  })
}

export const orgDeleteReport = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(org(auth0Id, `/reports/${encodeURIComponent(id)}`), {
    method: "DELETE",
  })
}

export const orgUpdateReport = async (
  auth0Id: string,
  id: string,
  input: { report_type?: string; period_start?: string | null; period_end?: string | null; title?: string },
): Promise<{ report: ReportRecord }> => {
  return apiFetch<{ report: ReportRecord }>(org(auth0Id, `/reports/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify(pickDefined(input)),
  })
}

// ── Performance metrics ──────────────────────────────────────────────────────

export const orgPerformanceMetrics = async (
  auth0Id: string,
  opts: { studentId: string; metricKey?: string; from?: string; to?: string },
): Promise<{ metrics: PerformanceMetric[] }> => {
  const params = new URLSearchParams({ studentId: opts.studentId })
  if (opts.metricKey) params.set("metricKey", opts.metricKey)
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)
  return apiFetch<{ metrics: PerformanceMetric[] }>(
    org(auth0Id, `/performance?${params.toString()}`),
  )
}

export const orgDeletePerformanceMetric = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(org(auth0Id, `/performance/${encodeURIComponent(id)}`), {
    method: "DELETE",
  })
}

export const orgUpdatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<{ metric: PerformanceMetric }> => {
  return apiFetch<{ metric: PerformanceMetric }>(
    org(auth0Id, `/performance/${encodeURIComponent(id)}`),
    { method: "PUT", body: JSON.stringify(input) },
  )
}

// ── Overview & analysis linking ──────────────────────────────────────────────

export const orgOverview = async (
  auth0Id: string,
): Promise<{ overview: OrgOverview }> => {
  return apiFetch<{ overview: OrgOverview }>(org(auth0Id, "/overview"))
}

export const linkAnalysisToStudent = async (
  auth0Id: string,
  jobId: string,
  studentId: string | null,
): Promise<{ analysis: DashboardAnalysis }> => {
  return apiFetch<{ analysis: DashboardAnalysis }>(
    `${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ student_id: studentId }),
    },
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== "") out[key as keyof T] = value as T[keyof T]
  }
  return out
}