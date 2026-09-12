import { Elysia } from "elysia"
import {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
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
  deletePerformanceMetric,
  getStudentPerformanceSeries,
  getStudentAnalyses,
  getOrgOverview,
  type StudentInput,
  type ScheduleInput,
  type AttendanceStatus,
} from "../lib/orgData"
import { buildError } from "../lib/errors"
import { isDate, isIsoDate, defaultReportTitle } from "../lib/orgValidate"

const ATTENDANCE_STATUSES = new Set(["present", "absent", "late", "excused"])
const EVENT_TYPES = new Set(["practice", "match", "tournament", "meeting", "other"])
const EVENT_STATUSES = new Set(["scheduled", "completed", "cancelled"])
const STUDENT_STATUSES = new Set(["active", "inactive", "transferred"])
const REPORT_TYPES = new Set(["progress", "attendance", "performance", "monthly"])

const parseStudentInput = (body: Record<string, unknown>) => {
  const input: StudentInput = {}
  const fields = [
    "full_name",
    "email",
    "phone",
    "sport",
    "position",
    "jersey_number",
    "date_of_birth",
    "gender",
    "guardian_name",
    "guardian_phone",
    "notes",
    "status",
    "joined_on",
  ]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

const parseScheduleInput = (body: Record<string, unknown>) => {
  const input: ScheduleInput = {}
  const fields = ["title", "event_type", "starts_at", "ends_at", "location", "description", "status"]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

export default new Elysia()
  // ── Students ───────────────────────────────────────────────────────────────
  .get("/api/org/:auth0Id/students", async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
    }
    const url = new URL(request.url)
    const students = await listStudents(auth0Id, {
      search: url.searchParams.get("search") ?? "",
      sport: url.searchParams.get("sport") ?? "",
      status: url.searchParams.get("status") ?? "",
    })
    set.status = 200
    return { students }
  })
  .get("/api/org/:auth0Id/students/sports", async ({ params, set }) => {
    const { auth0Id } = params
    const sports = await listStudentSports(auth0Id)
    set.status = 200
    return { sports }
  })
  .get("/api/org/:auth0Id/students/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError("NOT_FOUND", "Student not found", false)
    }
    set.status = 200
    return { student }
  })
  .post("/api/org/:auth0Id/students", async ({ params, body, set }) => {
    const { auth0Id } = params
    const input = parseStudentInput(body as Record<string, unknown>)

    if (!input.full_name || typeof input.full_name !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required field: full_name", false)
    }
    if (input.status !== undefined && !STUDENT_STATUSES.has(input.status as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `status must be one of ${[...STUDENT_STATUSES].join(", ")}`, false)
    }
    if (input.jersey_number !== undefined && typeof input.jersey_number !== "number") {
      set.status = 400
      return buildError("INVALID_REQUEST", "jersey_number must be a number", false)
    }
    if (input.date_of_birth !== undefined && !isDate(input.date_of_birth)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "date_of_birth must be YYYY-MM-DD", false)
    }
    if (input.joined_on !== undefined && !isDate(input.joined_on)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "joined_on must be YYYY-MM-DD", false)
    }

    const student = await createStudent(auth0Id, input)
    if (!student) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to create student", true)
    }
    set.status = 201
    return { student }
  })
  .put("/api/org/:auth0Id/students/:id", async ({ params, body, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }
    const existing = await getStudent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError("NOT_FOUND", "Student not found", false)
    }

    const input = parseStudentInput(body as Record<string, unknown>)
    if (input.full_name !== undefined && typeof input.full_name !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "full_name must be a string", false)
    }
    if (input.status !== undefined && !STUDENT_STATUSES.has(input.status as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `status must be one of ${[...STUDENT_STATUSES].join(", ")}`, false)
    }
    if (input.jersey_number !== undefined && input.jersey_number !== null && typeof input.jersey_number !== "number") {
      set.status = 400
      return buildError("INVALID_REQUEST", "jersey_number must be a number", false)
    }
    if (input.date_of_birth !== undefined && input.date_of_birth !== null && !isDate(input.date_of_birth)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "date_of_birth must be YYYY-MM-DD", false)
    }
    if (input.joined_on !== undefined && input.joined_on !== null && !isDate(input.joined_on)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "joined_on must be YYYY-MM-DD", false)
    }

    const student = await updateStudent(auth0Id, id, input)
    if (!student) {
      set.status = 404
      return buildError("NOT_FOUND", "Student not found", false)
    }
    set.status = 200
    return { student }
  })
  .delete("/api/org/:auth0Id/students/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteStudent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError("NOT_FOUND", "Student not found", false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Student detail: attendance, performance, analyses ─────────────────────
  .get("/api/org/:auth0Id/students/:id/performance", async ({ params, request, set }) => {
    const { auth0Id, id } = params
    const url = new URL(request.url)
    const series = await getStudentPerformanceSeries(auth0Id, id, {
      metricKey: url.searchParams.get("metricKey") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    })
    set.status = 200
    return { series }
  })
  .post("/api/org/:auth0Id/students/:id/performance", async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const { metric_key, metric_value, unit, measured_at } = body as Record<string, unknown>
    if (!metric_key || typeof metric_key !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required field: metric_key", false)
    }
    if (typeof metric_value !== "number" || !Number.isFinite(metric_value)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "metric_value must be a finite number", false)
    }
    if (measured_at !== undefined && !isIsoDate(measured_at)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "measured_at must be a valid ISO datetime", false)
    }

    const metric = await createPerformanceMetric(auth0Id, {
      student_id: id,
      metric_key: metric_key as string,
      metric_value: metric_value as number,
      unit: typeof unit === "string" ? unit : null,
      measured_at: typeof measured_at === "string" ? measured_at : null,
    })
    if (!metric) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to save performance metric", true)
    }
    set.status = 201
    return { metric }
  })
  .get("/api/org/:auth0Id/students/:id/analyses", async ({ params, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }
    const analyses = await getStudentAnalyses(auth0Id, id)
    set.status = 200
    return { analyses }
  })
  // ── Attendance ─────────────────────────────────────────────────────────────
  .get("/api/org/:auth0Id/attendance", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const records = await listAttendance(auth0Id, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      studentId: url.searchParams.get("studentId") ?? undefined,
    })
    set.status = 200
    return { records }
  })
  .get("/api/org/:auth0Id/attendance/summary", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const summary = await attendanceSummary(auth0Id, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      studentId: url.searchParams.get("studentId") ?? undefined,
    })
    set.status = 200
    return { summary }
  })
  .put("/api/org/:auth0Id/attendance", async ({ params, body, set }) => {
    const { auth0Id } = params
    const { student_id, session_date, status, note } = body as Record<string, unknown>
    if (!student_id || !session_date || !ATTENDANCE_STATUSES.has(status as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing or invalid attendance fields", false)
    }
    const record = await upsertAttendance(
      auth0Id,
      student_id as string,
      session_date as string,
      status as AttendanceStatus,
      typeof note === "string" ? note : null,
    )
    if (!record) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to save attendance", true)
    }
    set.status = 200
    return { record }
  })
  .post("/api/org/:auth0Id/attendance/batch", async ({ params, body, set }) => {
    const { auth0Id } = params
    const { entries } = body as { entries?: unknown[] }
    if (!Array.isArray(entries) || entries.length === 0) {
      set.status = 400
      return buildError("INVALID_REQUEST", "entries must be a non-empty array", false)
    }
    const invalid = entries.find((entry) => {
      const e = entry as Record<string, unknown>
      const sessionDate = typeof e.session_date === "string" ? e.session_date : ""
      return (
        typeof e.student_id !== "string" ||
        !e.student_id ||
        !isDate(sessionDate) ||
        !ATTENDANCE_STATUSES.has(e.status as string)
      )
    })
    if (invalid) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Entry requires a valid student_id, session_date (YYYY-MM-DD) and status", false)
    }

    const parsed = entries.map((entry) => {
      const e = entry as Record<string, unknown>
      return {
        studentId: e.student_id as string,
        sessionDate: e.session_date as string,
        status: e.status as AttendanceStatus,
        note: typeof e.note === "string" ? e.note : null,
      }
    })
    const records = await setAttendanceBatch(auth0Id, parsed)
    set.status = 200
    return { records, count: records.length }
  })
  .delete("/api/org/:auth0Id/attendance", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const studentId = url.searchParams.get("studentId")
    const sessionDate = url.searchParams.get("date")
    if (!studentId || !sessionDate) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing studentId or date", false)
    }
    const deleted = await deleteAttendance(auth0Id, studentId, sessionDate)
    if (!deleted) {
      set.status = 404
      return buildError("NOT_FOUND", "Attendance record not found", false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Schedule ───────────────────────────────────────────────────────────────
  .get("/api/org/:auth0Id/schedule", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const events = await listSchedule(auth0Id, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    })
    set.status = 200
    return { events }
  })
  .post("/api/org/:auth0Id/schedule", async ({ params, body, set }) => {
    const { auth0Id } = params
    const input = parseScheduleInput(body as Record<string, unknown>)
    if (!input.title || typeof input.title !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required field: title", false)
    }
    if (!input.starts_at || !isIsoDate(input.starts_at)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "starts_at must be a valid ISO datetime", false)
    }
    if (input.event_type !== undefined && !EVENT_TYPES.has(input.event_type as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `event_type must be one of ${[...EVENT_TYPES].join(", ")}`, false)
    }
    if (input.status !== undefined && !EVENT_STATUSES.has(input.status as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `status must be one of ${[...EVENT_STATUSES].join(", ")}`, false)
    }
    if (input.ends_at !== undefined && input.ends_at !== null && !isIsoDate(input.ends_at)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "ends_at must be a valid ISO datetime", false)
    }

    const event = await createScheduleEvent(auth0Id, input)
    if (!event) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to create schedule event", true)
    }
    set.status = 201
    return { event }
  })
  .put("/api/org/:auth0Id/schedule/:id", async ({ params, body, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }
    const input = parseScheduleInput(body as Record<string, unknown>)
    if (input.starts_at !== undefined && typeof input.starts_at !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "starts_at must be a valid ISO datetime", false)
    }
    if (input.event_type !== undefined && !EVENT_TYPES.has(input.event_type as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `event_type must be one of ${[...EVENT_TYPES].join(", ")}`, false)
    }
    if (input.status !== undefined && !EVENT_STATUSES.has(input.status as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `status must be one of ${[...EVENT_STATUSES].join(", ")}`, false)
    }

    const event = await updateScheduleEvent(auth0Id, id, input)
    if (!event) {
      set.status = 404
      return buildError("NOT_FOUND", "Schedule event not found", false)
    }
    set.status = 200
    return { event }
  })
  .delete("/api/org/:auth0Id/schedule/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteScheduleEvent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError("NOT_FOUND", "Schedule event not found", false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Reports ────────────────────────────────────────────────────────────────
  .get("/api/org/:auth0Id/reports", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const reports = await listReports(auth0Id, {
      studentId: url.searchParams.get("studentId") ?? undefined,
    })
    set.status = 200
    return { reports }
  })
  .get("/api/org/:auth0Id/reports/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    const report = await getReport(auth0Id, id)
    if (!report) {
      set.status = 404
      return buildError("NOT_FOUND", "Report not found", false)
    }
    set.status = 200
    return { report }
  })
  .post("/api/org/:auth0Id/reports", async ({ params, body, set }) => {
    const { auth0Id } = params
    const { student_id, report_type, period_start, period_end, title } = body as Record<string, unknown>

    if (!report_type || !REPORT_TYPES.has(report_type as string)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `report_type must be one of ${[...REPORT_TYPES].join(", ")}`, false)
    }
    if (student_id && (await getStudent(auth0Id, student_id as string)) === null) {
      set.status = 404
      return buildError("NOT_FOUND", "Student not found", false)
    }
    if (period_start !== undefined && !isDate(period_start)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "period_start must be YYYY-MM-DD", false)
    }
    if (period_end !== undefined && !isDate(period_end)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "period_end must be YYYY-MM-DD", false)
    }

    const from = isDate(period_start) ? period_start : undefined
    const to = isDate(period_end) ? period_end : undefined

    const content = await buildReportContent(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      from,
      to,
      report_type: report_type as string,
    })

    const student = student_id ? await getStudent(auth0Id, student_id as string) : null

    const report = await createReportRecord(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      report_type: report_type as string,
      title: typeof title === "string" && title ? title : defaultReportTitle(report_type as string, student),
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to create report", true)
    }
    set.status = 201
    return { report }
  })
  .put("/api/org/:auth0Id/reports/:id", async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const existing = await getReport(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError("NOT_FOUND", "Report not found", false)
    }

    const { report_type, period_start, period_end, title } = body as Record<string, unknown>

    const nextType = report_type === undefined ? existing.report_type : String(report_type)
    if (!REPORT_TYPES.has(nextType)) {
      set.status = 400
      return buildError("INVALID_REQUEST", `report_type must be one of ${[...REPORT_TYPES].join(", ")}`, false)
    }
    if (period_start !== undefined && period_start !== null && !isDate(period_start)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "period_start must be YYYY-MM-DD", false)
    }
    if (period_end !== undefined && period_end !== null && !isIsoDate(period_end) && !isDate(period_end)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "period_end must be YYYY-MM-DD", false)
    }

    const from = period_start === undefined ? existing.period_start : isDate(period_start) ? period_start : null
    const to = period_end === undefined ? existing.period_end : isDate(period_end) ? period_end : null

    const content = await buildReportContent(auth0Id, {
      student_id: existing.student_id,
      from,
      to,
      report_type: nextType,
    })

    const report = await updateReportRecord(auth0Id, id, {
      report_type: nextType,
      title:
        typeof title === "string" && title.trim()
          ? title.trim()
          : existing.title,
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to update report", true)
    }
    set.status = 200
    return { report }
  })
  .delete("/api/org/:auth0Id/reports/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteReport(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError("NOT_FOUND", "Report not found", false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Performance metrics (cross-student) ────────────────────────────────────
  .get("/api/org/:auth0Id/performance", async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const studentId = url.searchParams.get("studentId")
    if (!studentId) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing studentId parameter", false)
    }
    const metrics = await listPerformance(auth0Id, studentId, {
      metricKey: url.searchParams.get("metricKey") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    })
    set.status = 200
    return { metrics }
  })
  .delete("/api/org/:auth0Id/performance/:id", async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deletePerformanceMetric(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError("NOT_FOUND", "Performance metric not found", false)
    }
    set.status = 200
    return { deleted: true }
  })
  // ── Overview ───────────────────────────────────────────────────────────────
  .get("/api/org/:auth0Id/overview", async ({ params, set }) => {
    const { auth0Id } = params
    const overview = await getOrgOverview(auth0Id)
    set.status = 200
    return { overview }
  })