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
