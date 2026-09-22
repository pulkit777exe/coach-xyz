import { Elysia } from 'elysia'
import {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
  importStudents,
  listStudentSports,
  listAttendance,
  upsertAttendance,
  setAttendanceBatch,
  deleteAttendance,
  attendanceSummary,
  listSchedule,
  createScheduleEvent,
  updateScheduleEvent,
  deleteScheduleEvent,
  listReports,
  getReport,
  createReportRecord,
  updateReportRecord,
  deleteReport,
  buildReportContent,
  listPerformance,
  createPerformanceMetric,
  updatePerformanceMetric,
  deletePerformanceMetric,
  listObjectives,
  createObjective,
  setObjectiveStatus,
  deleteObjective,
  listSeasons,
  createSeason,
  deleteSeason,
  listMatches,
  createMatch,
  deleteMatch,
  listTrainingPlans,
  createTrainingPlan,
  setTrainingPlanStatus,
  deleteTrainingPlan,
  listWellness,
  createWellnessCheckin,
  getStudentPerformanceSeries,
  getStudentTrends,
  compareStudents,
  getStudentAnalyses,
  getOrgOverview,
  searchOrg,
  type StudentInput,
  type ScheduleInput,
  type AttendanceStatus,
} from '../lib/orgData'
import { buildError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import {
  isDate,
  isIsoDate,
  defaultReportTitle,
  validateStudentRow,
  MAX_IMPORT_ROWS,
  DEFAULT_COMPARISON_METRIC_KEY,
} from '../lib/orgValidate'
import type { ImportRow } from '../lib/orgValidate'
import {
  linkAnalysisToStudent,
  getOrgTier,
  getTodayUsage,
  orgDailyAnalysisLimit,
} from '../lib/analyses'
import { getTeam } from '../lib/teams'
import { resolveCaller } from '../lib/caller'
import { hasPermission } from '../lib/permissions'
import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
  type ReportType,
} from '../lib/orgEnums'

const ATTENDANCE_STATUS_SET: ReadonlySet<string> = new Set(ATTENDANCE_STATUSES)
const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES)
const EVENT_STATUS_SET: ReadonlySet<string> = new Set(EVENT_STATUSES)
const STUDENT_STATUS_SET: ReadonlySet<string> = new Set(STUDENT_STATUSES)
const REPORT_TYPE_SET: ReadonlySet<string> = new Set(REPORT_TYPES)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Hierarchy scope for roster reads (§3: owner → coaches → players).
 * Owners/admins see all; staff see their teams' students only.
 */
const studentScope = async (
  orgAuth0Id: string,
  request: Request,
): Promise<{ all: true } | { all: false; teamIds: string[] }> => {
  return (await resolveCaller(orgAuth0Id, request)).studentScope
}

/**
 * Validate an optional team assignment: null/"" clears it, otherwise the
 * team must exist in this org (prevents cross-org linkage).
 */
const resolveTeamId = async (
  auth0Id: string,
  raw: unknown,
): Promise<{ ok: true; teamId: string | null } | { ok: false; error: string }> => {
  if (raw === undefined || raw === null || raw === '') return { ok: true, teamId: null }
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    return { ok: false, error: 'team_id must be a valid UUID or null' }
  }
  const team = await getTeam(auth0Id, raw)
  if (!team) return { ok: false, error: 'team not found in this organization' }
  return { ok: true, teamId: raw }
}

const parseStudentInput = (body: Record<string, unknown>) => {
  const input: StudentInput = {}
  const fields = [
    'full_name',
    'email',
    'phone',
    'sport',
    'position',
    'jersey_number',
    'date_of_birth',
    'gender',
    'guardian_name',
    'guardian_phone',
    'notes',
    'status',
    'joined_on',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

const parseScheduleInput = (body: Record<string, unknown>) => {
  const input: ScheduleInput = {}
  const fields = [
    'title',
    'event_type',
    'starts_at',
    'ends_at',
    'location',
    'description',
    'status',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

export default new Elysia()
  .use(serviceGuard)
  // ── Students ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const scope = await studentScope(auth0Id, request)
    const students = await listStudents(auth0Id, {
      search: url.searchParams.get('search') ?? '',
      sport: url.searchParams.get('sport') ?? '',
      status: url.searchParams.get('status') ?? '',
      teamId: url.searchParams.get('team_id') ?? '',
      ...(scope.all ? {} : { teamIds: scope.teamIds }),
    })
    set.status = 200
    return { students }
  })
  .get('/api/org/:auth0Id/students/sports', async ({ params, set }) => {
    const { auth0Id } = params
    const sports = await listStudentSports(auth0Id)
    set.status = 200
    return { sports }
  })
  .get('/api/org/:auth0Id/students/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    // Hierarchy: staff outside the student's team get 404 (not 403 — no
    // membership oracle for roster enumeration).
    const scope = await studentScope(auth0Id, request)
    if (!scope.all && !(student.team_id && scope.teamIds.includes(student.team_id))) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 200
    return { student }
  })
  .post('/api/org/:auth0Id/students', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const input = parseStudentInput(body as Record<string, unknown>)

    if (!input.full_name || typeof input.full_name !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: full_name', false)
    }
    if (input.status !== undefined && !STUDENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...STUDENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (input.jersey_number !== undefined && typeof input.jersey_number !== 'number') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'jersey_number must be a number', false)
    }
    if (input.date_of_birth !== undefined && !isDate(input.date_of_birth)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'date_of_birth must be YYYY-MM-DD', false)
    }
    if (input.joined_on !== undefined && !isDate(input.joined_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'joined_on must be YYYY-MM-DD', false)
    }
    const team = await resolveTeamId(auth0Id, (body as Record<string, unknown>).team_id)
    if (!team.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', team.error, false)
    }
    if (team.teamId) {
      input.team_id = team.teamId
    } else {
      // Hierarchy convenience: a coach with exactly one team creates
      // players under that team unless another is chosen.
      const auto = await resolveCaller(auth0Id, request)
      if (auto.role === 'coach' || auto.role === 'analyst' || auto.role === 'medical') {
        if (auto.teamIds.length === 1) input.team_id = auto.teamIds[0]
      }
    }

    const student = await createStudent(auth0Id, input)
    if (!student) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create student', true)
    }
    set.status = 201
    return { student }
  })
  .put('/api/org/:auth0Id/students/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const existing = await getStudent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }

    const input = parseStudentInput(body as Record<string, unknown>)
    if (input.full_name !== undefined && typeof input.full_name !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'full_name must be a string', false)
    }
    if (input.status !== undefined && !STUDENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...STUDENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (
      input.jersey_number !== undefined &&
      input.jersey_number !== null &&
      typeof input.jersey_number !== 'number'
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'jersey_number must be a number', false)
    }
    if (
      input.date_of_birth !== undefined &&
      input.date_of_birth !== null &&
      !isDate(input.date_of_birth)
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'date_of_birth must be YYYY-MM-DD', false)
    }
    if (input.joined_on !== undefined && input.joined_on !== null && !isDate(input.joined_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'joined_on must be YYYY-MM-DD', false)
    }
    if ('team_id' in (body as Record<string, unknown>)) {
      const team = await resolveTeamId(auth0Id, (body as Record<string, unknown>).team_id)
      if (!team.ok) {
        set.status = 400
        return buildError('INVALID_REQUEST', team.error, false)
      }
      // Scoped staff can only assign teams they belong to.
      const scope = await studentScope(auth0Id, request)
      if (!scope.all && team.teamId && !scope.teamIds.includes(team.teamId)) {
        set.status = 403
        return buildError('FORBIDDEN', 'Cannot assign a team outside your scope', false)
      }
      input.team_id = team.teamId
    }

    const student = await updateStudent(auth0Id, id, input)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 200
    return { student }
  })
  .delete('/api/org/:auth0Id/students/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteStudent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .post('/api/org/:auth0Id/students/import', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { rows } = body as { rows?: unknown[] }
    if (!Array.isArray(rows) || rows.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'rows must be a non-empty array', false)
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      set.status = 400
      return buildError('INVALID_REQUEST', `Maximum ${MAX_IMPORT_ROWS} rows per import`, false)
    }

    const validated: Array<{ cleaned: Record<string, unknown> }> = []
    const failed: Array<{ row_index: number; reason: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ImportRow
      const result = validateStudentRow(row)
      if (result.ok) {
        validated.push({ cleaned: result.cleaned })
      } else {
        failed.push({ row_index: i, reason: result.reason })
      }
    }

    if (validated.length === 0) {
      set.status = 400
      return { imported: 0, failed, duplicates_skipped: 0 }
    }

    const importResult = await importStudents(auth0Id, validated)
    // Merge pre-validation failures with data-layer failures
    importResult.failed = [...failed, ...importResult.failed]

    set.status = 200
    return {
      imported: importResult.imported,
      failed: importResult.failed,
      duplicates_skipped: importResult.duplicates_skipped,
    }
  })
  // ── Student detail: attendance, performance, analyses ─────────────────────
  .get('/api/org/:auth0Id/students/:id/performance', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    const url = new URL(request.url)
    const series = await getStudentPerformanceSeries(auth0Id, id, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { series }
  })
  .post('/api/org/:auth0Id/students/:id/performance', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const { metric_key, metric_value, unit, measured_at } = body as Record<string, unknown>
    if (!metric_key || typeof metric_key !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: metric_key', false)
    }
    if (typeof metric_value !== 'number' || !Number.isFinite(metric_value)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'metric_value must be a finite number', false)
    }
    if (measured_at !== undefined && !isIsoDate(measured_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'measured_at must be a valid ISO datetime', false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found in this organization', false)
    }
    const metric = await createPerformanceMetric(auth0Id, {
      student_id: id,
      metric_key: metric_key as string,
      metric_value: metric_value as number,
      unit: typeof unit === 'string' ? unit : null,
      measured_at: typeof measured_at === 'string' ? measured_at : null,
    })
    if (!metric) {
      set.status = 409
      return buildError(
        'ALREADY_EXISTS',
        'A metric for this key already exists at that timestamp',
        false,
      )
    }
    set.status = 201
    return { metric }
  })
  .get('/api/org/:auth0Id/students/:id/analyses', async ({ params, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const analyses = await getStudentAnalyses(auth0Id, id)
    set.status = 200
    return { analyses }
  })
  .put('/api/org/:auth0Id/analyses/:jobId/student', async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const { student_id } = body as { student_id?: unknown }
    if (student_id !== undefined && student_id !== null && typeof student_id !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a string or null', false)
    }
    if (student_id && (await getStudent(auth0Id, student_id)) === null) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    const analysis = await linkAnalysisToStudent(
      auth0Id,
      jobId,
      (student_id as string | null) ?? null,
    )
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    set.status = 200
    return { analysis }
  })
  // ── Attendance ─────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/attendance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const records = await listAttendance(auth0Id, {
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      studentId: url.searchParams.get('studentId') ?? undefined,
    })
    set.status = 200
    return { records }
  })
  .get('/api/org/:auth0Id/attendance/summary', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const summary = await attendanceSummary(auth0Id, {
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      studentId: url.searchParams.get('studentId') ?? undefined,
    })
    set.status = 200
    return { summary }
  })
  .put('/api/org/:auth0Id/attendance', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { student_id, session_date, status, note } = body as Record<string, unknown>
    if (!student_id || !session_date || !ATTENDANCE_STATUS_SET.has(status as string)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing or invalid attendance fields', false)
    }
    const student = await getStudent(auth0Id, student_id as string)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found in this organization', false)
    }
    const record = await upsertAttendance(
      auth0Id,
      student_id as string,
      session_date as string,
      status as AttendanceStatus,
      typeof note === 'string' ? note : null,
    )
    if (!record) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to save attendance', true)
    }
    set.status = 200
    return { record }
  })
  .post('/api/org/:auth0Id/attendance/batch', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { entries } = body as { entries?: unknown[] }
    if (!Array.isArray(entries) || entries.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'entries must be a non-empty array', false)
    }
    const invalid = entries.find((entry) => {
      const e = entry as Record<string, unknown>
      const sessionDate = typeof e.session_date === 'string' ? e.session_date : ''
      return (
        typeof e.student_id !== 'string' ||
        !e.student_id ||
        !isDate(sessionDate) ||
        !ATTENDANCE_STATUS_SET.has(e.status as string)
      )
    })
    if (invalid) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        'Entry requires a valid student_id, session_date (YYYY-MM-DD) and status',
        false,
      )
    }

    // Verify every student belongs to this org before any write.
    for (const entry of entries) {
      const exists = await getStudent(
        auth0Id,
        (entry as Record<string, unknown>).student_id as string,
      )
      if (!exists) {
        set.status = 404
        return buildError(
          'NOT_FOUND',
          `Student ${(entry as Record<string, unknown>).student_id} not found in this organization`,
          false,
        )
      }
    }

    const parsed = entries.map((entry) => {
      const e = entry as Record<string, unknown>
      return {
        studentId: e.student_id as string,
        sessionDate: e.session_date as string,
        status: e.status as AttendanceStatus,
        note: typeof e.note === 'string' ? e.note : null,
      }
    })
    const records = await setAttendanceBatch(auth0Id, parsed)
    set.status = 200
    return { records, count: records.length }
  })
  .delete('/api/org/:auth0Id/attendance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    const sessionDate = url.searchParams.get('date')
    if (!studentId || !sessionDate) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing studentId or date', false)
    }
    const deleted = await deleteAttendance(auth0Id, studentId, sessionDate)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Attendance record not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Schedule ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/schedule', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const events = await listSchedule(auth0Id, {
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { events }
  })
  .post('/api/org/:auth0Id/schedule', async ({ params, body, set }) => {
    const { auth0Id } = params
    const input = parseScheduleInput(body as Record<string, unknown>)
    if (!input.title || typeof input.title !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: title', false)
    }
    if (!input.starts_at || !isIsoDate(input.starts_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_at must be a valid ISO datetime', false)
    }
    if (input.event_type !== undefined && !EVENT_TYPE_SET.has(input.event_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `event_type must be one of ${[...EVENT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (input.status !== undefined && !EVENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...EVENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (input.ends_at !== undefined && input.ends_at !== null && !isIsoDate(input.ends_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'ends_at must be a valid ISO datetime', false)
    }

    const event = await createScheduleEvent(auth0Id, input)
    if (!event) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create schedule event', true)
    }
    set.status = 201
    return { event }
  })
  .put('/api/org/:auth0Id/schedule/:id', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const input = parseScheduleInput(body as Record<string, unknown>)
    if (input.starts_at !== undefined && typeof input.starts_at !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_at must be a valid ISO datetime', false)
    }
    if (input.event_type !== undefined && !EVENT_TYPE_SET.has(input.event_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `event_type must be one of ${[...EVENT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (input.status !== undefined && !EVENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...EVENT_STATUS_SET].join(', ')}`,
        false,
      )
    }

    const event = await updateScheduleEvent(auth0Id, id, input)
    if (!event) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    set.status = 200
    return { event }
  })
  .delete('/api/org/:auth0Id/schedule/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteScheduleEvent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Reports ────────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/reports', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const reports = await listReports(auth0Id, {
      studentId: url.searchParams.get('studentId') ?? undefined,
    })
    set.status = 200
    return { reports }
  })
  .get('/api/org/:auth0Id/reports/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const report = await getReport(auth0Id, id)
    if (!report) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { report }
  })
  .post('/api/org/:auth0Id/reports', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { student_id, report_type, period_start, period_end, title } = body as Record<
      string,
      unknown
    >

    if (!report_type || !REPORT_TYPE_SET.has(report_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${[...REPORT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (student_id && (await getStudent(auth0Id, student_id as string)) === null) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    if (period_start !== undefined && !isDate(period_start)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false)
    }
    if (period_end !== undefined && !isDate(period_end)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false)
    }

    const from = isDate(period_start) ? period_start : undefined
    const to = isDate(period_end) ? period_end : undefined
    const nextType = report_type as ReportType

    const content = await buildReportContent(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      from,
      to,
      report_type: nextType,
    })

    const student = student_id ? await getStudent(auth0Id, student_id as string) : null

    const report = await createReportRecord(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      report_type: nextType,
      title: typeof title === 'string' && title ? title : defaultReportTitle(nextType, student),
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create report', true)
    }
    set.status = 201
    return { report }
  })
  .put('/api/org/:auth0Id/reports/:id', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const existing = await getReport(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }

    const { report_type, period_start, period_end, title } = body as Record<string, unknown>

    const toYmd = (v: unknown): string | null =>
      v === null || v === undefined
        ? null
        : typeof v === 'string'
          ? v
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : String(v)

    const nextType = (
      report_type === undefined ? existing.report_type : String(report_type)
    ) as ReportType
    if (!REPORT_TYPE_SET.has(nextType)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${[...REPORT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (period_start !== undefined && period_start !== null && !isDate(period_start)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false)
    }
    if (
      period_end !== undefined &&
      period_end !== null &&
      !isIsoDate(period_end) &&
      !isDate(period_end)
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false)
    }

    const from =
      period_start === undefined
        ? toYmd(existing.period_start)
        : isDate(period_start)
          ? period_start
          : null
    const to =
      period_end === undefined ? toYmd(existing.period_end) : isDate(period_end) ? period_end : null

    const content = await buildReportContent(auth0Id, {
      student_id: existing.student_id,
      from,
      to,
      report_type: nextType,
    })

    const report = await updateReportRecord(auth0Id, id, {
      report_type: nextType,
      title: typeof title === 'string' && title.trim() ? title.trim() : existing.title,
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to update report', true)
    }
    set.status = 200
    return { report }
  })
  .delete('/api/org/:auth0Id/reports/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteReport(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Training objectives (§26 loop) ───────────────────────────────────────
  .get('/api/org/:auth0Id/objectives', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    const objectives = await listObjectives(auth0Id, {
      studentId: pickId(url.searchParams.get('student_id')),
      teamId: pickId(url.searchParams.get('team_id')),
      status: url.searchParams.get('status'),
    })
    set.status = 200
    return { objectives }
  })
  .post('/api/org/:auth0Id/objectives', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    const title = typeof raw.title === 'string' ? raw.title : ''
    if (!title.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'title is required', false)
    }
    if (raw.due_on !== undefined && raw.due_on !== null && !isDate(raw.due_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'due_on must be YYYY-MM-DD', false)
    }
    const objective = await createObjective(auth0Id, caller.verified, {
      student_id: pickId(raw.student_id),
      team_id: pickId(raw.team_id),
      finding_id: typeof raw.finding_id === 'string' ? raw.finding_id : null,
      analysis_job_id: typeof raw.analysis_job_id === 'string' ? raw.analysis_job_id : null,
      title,
      description: typeof raw.description === 'string' ? raw.description : null,
      due_on: typeof raw.due_on === 'string' ? raw.due_on : null,
    })
    if (!objective) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        'Could not create objective (unknown student/team?)',
        false,
      )
    }
    set.status = 201
    return { objective }
  })
  .patch('/api/org/:auth0Id/objectives/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid objective id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const { status } = (body ?? {}) as { status?: unknown }
    if (status !== 'active' && status !== 'done' && status !== 'archived') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'status must be active, done, or archived', false)
    }
    const objective = await setObjectiveStatus(auth0Id, id, status)
    if (!objective) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    set.status = 200
    return { objective }
  })
  .delete('/api/org/:auth0Id/objectives/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid objective id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const removed = await deleteObjective(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Subscription & usage (billing structure, §28) ──────────────────────
  .get('/api/org/:auth0Id/subscription', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (role !== 'owner' && role !== 'admin') {
      set.status = 403
      return buildError('FORBIDDEN', 'Subscription details are owner/admin only', false)
    }
    set.status = 200
    return {
      subscription: { tier: await getOrgTier(auth0Id), status: 'active' },
      usage_today: await getTodayUsage(auth0Id),
      daily_analysis_limit: orgDailyAnalysisLimit(),
    }
  })
  // ── Seasons & matches ────────────────────────────────────────────────
  .get('/api/org/:auth0Id/seasons', async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    set.status = 200
    return { seasons: await listSeasons(auth0Id) }
  })
  .post('/api/org/:auth0Id/seasons', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires team.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    if (raw.starts_on !== undefined && raw.starts_on !== null && !isDate(raw.starts_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_on must be YYYY-MM-DD', false)
    }
    if (raw.ends_on !== undefined && raw.ends_on !== null && !isDate(raw.ends_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'ends_on must be YYYY-MM-DD', false)
    }
    const season = await createSeason(auth0Id, {
      name: typeof raw.name === 'string' ? raw.name : '',
      starts_on: typeof raw.starts_on === 'string' ? raw.starts_on : null,
      ends_on: typeof raw.ends_on === 'string' ? raw.ends_on : null,
    })
    if (!season) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'name is required', false)
    }
    set.status = 201
    return { season }
  })
  .delete('/api/org/:auth0Id/seasons/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid season id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires team.manage', false)
    }
    const removed = await deleteSeason(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Season not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .get('/api/org/:auth0Id/matches', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    set.status = 200
    return {
      matches: await listMatches(auth0Id, {
        teamId: pickId(url.searchParams.get('team_id')),
        seasonId: pickId(url.searchParams.get('season_id')),
      }),
    }
  })
  .post('/api/org/:auth0Id/matches', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing matches requires team.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    if (raw.match_on !== undefined && raw.match_on !== null && !isDate(raw.match_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'match_on must be YYYY-MM-DD', false)
    }
    const teamId = pickId(raw.team_id)
    if (teamId && !(await getTeam(auth0Id, teamId))) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'team not found in this organization', false)
    }
    const match = await createMatch(auth0Id, {
      team_id: teamId,
      season_id: pickId(raw.season_id),
      opponent: typeof raw.opponent === 'string' ? raw.opponent : null,
      match_on: typeof raw.match_on === 'string' ? raw.match_on : null,
      location: typeof raw.location === 'string' ? raw.location : null,
      result: typeof raw.result === 'string' ? raw.result : null,
    })
    if (!match) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Could not create match', true)
    }
    set.status = 201
    return { match }
  })
  .delete('/api/org/:auth0Id/matches/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid match id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing matches requires team.manage', false)
    }
    const removed = await deleteMatch(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Match not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Training plans ───────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/plans', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    set.status = 200
    return {
      plans: await listTrainingPlans(auth0Id, {
        teamId: pickId(url.searchParams.get('team_id')),
        studentId: pickId(url.searchParams.get('student_id')),
      }),
    }
  })
  .post('/api/org/:auth0Id/plans', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    const title = typeof raw.title === 'string' ? raw.title : ''
    if (!title.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'title is required', false)
    }
    const plan = await createTrainingPlan(auth0Id, caller.verified, {
      team_id: pickId(raw.team_id),
      student_id: pickId(raw.student_id),
      title,
      description: typeof raw.description === 'string' ? raw.description : null,
    })
    if (!plan) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Could not create plan (unknown student/team?)', false)
    }
    set.status = 201
    return { plan }
  })
  .patch('/api/org/:auth0Id/plans/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid plan id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const { status } = (body ?? {}) as { status?: unknown }
    if (status !== 'active' && status !== 'done' && status !== 'archived') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'status must be active, done, or archived', false)
    }
    const plan = await setTrainingPlanStatus(auth0Id, id, status)
    if (!plan) {
      set.status = 404
      return buildError('NOT_FOUND', 'Plan not found', false)
    }
    set.status = 200
    return { plan }
  })
  .delete('/api/org/:auth0Id/plans/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid plan id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const removed = await deleteTrainingPlan(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Plan not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Wellness check-ins (health data, §5) ─────────────────────────────────
  // Reads require the medical permission; writes require player.manage.
  // The AI layer reports wellness observations verbatim — never diagnoses.
  .get('/api/org/:auth0Id/students/:id/wellness', async ({ params, request, set }) => {
    const { auth0Id, id: studentId } = params
    if (!auth0Id || !studentId || !UUID_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('medical.read')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Reading wellness data requires the medical permission', false)
    }
    set.status = 200
    return { checkins: await listWellness(auth0Id, studentId) }
  })
  .post(
    '/api/org/:auth0Id/students/:id/wellness',
    async ({ params, body, request, set }) => {
      const { auth0Id, id: studentId } = params
      if (!auth0Id || !studentId || !UUID_RE.test(studentId)) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Invalid student id', false)
      }
      const caller = await resolveCaller(auth0Id, request)
      const verified = caller.verified
      if (!caller.can('player.manage')) {
        set.status = 403
        return buildError('FORBIDDEN', 'Recording wellness data requires player.manage', false)
      }
      const raw = (body ?? {}) as Record<string, unknown>
      const checkin = await createWellnessCheckin(auth0Id, verified, {
        student_id: studentId,
        sleep_hours: typeof raw.sleep_hours === 'number' ? raw.sleep_hours : null,
        fatigue: typeof raw.fatigue === 'number' ? raw.fatigue : null,
        pain: typeof raw.pain === 'string' ? raw.pain : null,
        availability: typeof raw.availability === 'string' ? raw.availability : null,
        note: typeof raw.note === 'string' ? raw.note : null,
      })
      if (!checkin) {
        set.status = 404
        return buildError('NOT_FOUND', 'Student not found', false)
      }
      set.status = 201
      return { checkin }
    },
  )
  // ── Performance metrics (cross-student) ────────────────────────────────────
  .get('/api/org/:auth0Id/performance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    if (!studentId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing studentId parameter', false)
    }
    const metrics = await listPerformance(auth0Id, studentId, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { metrics }
  })
  .delete('/api/org/:auth0Id/performance/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deletePerformanceMetric(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .put('/api/org/:auth0Id/performance/:id', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const { metric_value, unit } = body as Record<string, unknown>
    if (typeof metric_value !== 'number' || !Number.isFinite(metric_value)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'metric_value must be a finite number', false)
    }
    const metric = await updatePerformanceMetric(auth0Id, id, {
      metric_value: metric_value as number,
      unit: typeof unit === 'string' ? unit : null,
    })
    if (!metric) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found or is analysis-linked', false)
    }
    set.status = 200
    return { metric }
  })
  // ── Student trends ────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students/:id/trends', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    const url = new URL(request.url)
    const trends = await getStudentTrends(auth0Id, id, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { trends }
  })
  // ── Student comparison ────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students/comparison', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id', false)
    }
    const url = new URL(request.url)
    const idsParam = url.searchParams.get('ids')
    if (!idsParam) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing ids query parameter', false)
    }
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length === 0 || ids.length > 10) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Provide 1-10 student ids', false)
    }
    const metricKey = url.searchParams.get('metricKey') ?? DEFAULT_COMPARISON_METRIC_KEY
    const comparison = await compareStudents(auth0Id, ids, metricKey)
    set.status = 200
    return { comparison }
  })
  // ── Overview ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/overview', async ({ params, set }) => {
    const { auth0Id } = params
    const overview = await getOrgOverview(auth0Id)
    set.status = 200
    return { overview }
  })
  // ── Global search (students, schedule, reports, analyses) ──────────────────
  .get('/api/org/:auth0Id/search', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const query = url.searchParams.get('q') ?? ''
    const results = await searchOrg(auth0Id, query)
    set.status = 200
    return results
  })
