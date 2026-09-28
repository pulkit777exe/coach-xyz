import {
  attendanceSummary,
  deleteAttendance,
  getStudent,
  listAttendance,
  setAttendanceBatch,
  upsertAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
  type Student,
} from '../../lib/orgData'
import { isDate } from '../../lib/orgValidate'
import { pickUuid } from '../../lib/uuid'
import { resolveCaller } from '../../lib/caller'
import { canSeeStudent, visibleStudentIds } from '../../lib/org/scope'
import { ATTENDANCE_STATUS_SET } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { notifyAttendanceRecorded } from '../../lib/notificationEvents'
import { logger } from '../../lib/logger'
import { Elysia } from 'elysia'

type AttendanceNotificationStudent = Pick<Student, 'id' | 'full_name' | 'account_auth0_id'>
type NotificationSender = Parameters<typeof notifyAttendanceRecorded>[1]

/**
 * `from`/`to`/`studentId` for the two read routes, or `null` after answering 400.
 *
 * All three reach a cast in the query, so a malformed value is a client error and
 * belongs at the boundary. `studentId` is optional, so a bad value narrows to
 * "no filter" rather than erroring — except that would silently widen a scoped
 * caller, so it is validated too.
 */
const attendanceWindow = (
  url: URL,
): { ok: true; from?: string; to?: string; studentId?: string } | { ok: false } => {
  const rawFrom = url.searchParams.get('from')
  const rawTo = url.searchParams.get('to')
  const rawStudent = url.searchParams.get('studentId')
  if ((rawFrom !== null && !isDate(rawFrom)) || (rawTo !== null && !isDate(rawTo))) {
    return { ok: false }
  }
  if (rawStudent !== null && !pickUuid(rawStudent)) {
    return { ok: false }
  }
  return {
    ok: true,
    from: rawFrom ?? undefined,
    to: rawTo ?? undefined,
    studentId: rawStudent ?? undefined,
  }
}

/** Capability is not scope: `attendance.write` says WHICH writes, not WHOSE. */
const OUT_OF_SCOPE_MESSAGE = 'Recording attendance is limited to the students in your team scope'

/** Fan out one notification per affected student, never once per batch row. */
export const fanOutAttendanceNotifications = async (
  students: AttendanceNotificationStudent[],
  records: AttendanceRecord[],
  notify?: NotificationSender,
): Promise<void> => {
  const recordByStudentId = new Map<string, AttendanceRecord>()
  for (const record of records) {
    if (!recordByStudentId.has(record.student_id)) {
      recordByStudentId.set(record.student_id, record)
    }
  }

  const notifiedStudentIds = new Set<string>()
  for (const student of students) {
    if (notifiedStudentIds.has(student.id) || !student.account_auth0_id) continue
    const record = recordByStudentId.get(student.id)
    if (!record) continue
    notifiedStudentIds.add(student.id)

    try {
      await notifyAttendanceRecorded(
        {
          auth0Id: student.account_auth0_id,
          title: 'Attendance recorded',
          body: student.full_name,
          data: {
            attendance_id: record.id,
            student_id: record.student_id,
            session_date: record.session_date,
            status: record.status,
            href: '/player',
          },
        },
        notify,
      )
    } catch (error) {
      logger.error('attendance_notification_error', {
        type: 'attendance_notification_error',
        auth0Id: student.account_auth0_id,
        studentId: student.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }
}

export default new Elysia()
  .use(serviceGuard)
  // ── Attendance ─────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/attendance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    const url = new URL(request.url)
    const window = attendanceWindow(url)
    if (!window.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid attendance filter', false)
    }
    const records = await listAttendance(auth0Id, {
      from: window.from,
      to: window.to,
      studentId: window.studentId,
      // `null` = org-wide (owner/admin/analyst/medical); a list narrows the
      // query to the caller's teams, and `[]` yields nothing.
      studentIds: await visibleStudentIds(auth0Id, caller.studentScope),
    })
    set.status = 200
    return { records }
  })
  .get('/api/org/:auth0Id/attendance/summary', async ({ params, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    const url = new URL(request.url)
    const window = attendanceWindow(url)
    if (!window.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid attendance filter', false)
    }
    const summary = await attendanceSummary(auth0Id, {
      from: window.from,
      to: window.to,
      studentId: window.studentId,
      studentIds: await visibleStudentIds(auth0Id, caller.studentScope),
    })
    set.status = 200
    return { summary }
  })
  .put('/api/org/:auth0Id/attendance', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Recording attendance requires the attendance.write permission',
        false,
      )
    }
    const { student_id, session_date, status, note } = body as Record<string, unknown>
    // This route and its batch sibling sit in the same file, 50 lines apart, and
    // only the batch validated its date. Both fed the values straight into a
    // `::date` / `::uuid` cast, so a malformed one raised 22P02/22007 and the
    // global handler answered 500 INTERNAL_ERROR where a 400 is the truth.
    const studentUuid = pickUuid(student_id)
    if (!studentUuid || !isDate(session_date) || !ATTENDANCE_STATUS_SET.has(status as string)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing or invalid attendance fields', false)
    }
    // Scope gate: refuse BEFORE the roster lookup, so an out-of-scope student id
    // never reaches the store (a write must not be attempted at all).
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, studentUuid)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE_MESSAGE, false)
    }
    const student = await getStudent(auth0Id, studentUuid)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found in this organization', false)
    }
    const record = await upsertAttendance(
      auth0Id,
      studentUuid,
      session_date as string,
      status as AttendanceStatus,
      typeof note === 'string' ? note : null,
    )
    if (!record) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to save attendance', true)
    }
    await fanOutAttendanceNotifications([student], [record])
    set.status = 200
    return { record }
  })
  .post('/api/org/:auth0Id/attendance/batch', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Recording attendance requires the attendance.write permission',
        false,
      )
    }
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
        !pickUuid(e.student_id) ||
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

    // Scope gate before ANY write: one bad entry refuses the whole batch, and
    // no student is read or written first.
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    const outOfScope = entries.find(
      (entry) =>
        !canSeeStudent(studentIds, (entry as Record<string, unknown>).student_id as string),
    )
    if (outOfScope) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE_MESSAGE, false)
    }

    // Verify every student belongs to this org before any write.
    const students: Student[] = []
    for (const entry of entries) {
      const student = await getStudent(
        auth0Id,
        (entry as Record<string, unknown>).student_id as string,
      )
      if (!student) {
        set.status = 404
        return buildError(
          'NOT_FOUND',
          `Student ${(entry as Record<string, unknown>).student_id} not found in this organization`,
          false,
        )
      }
      students.push(student)
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
    await fanOutAttendanceNotifications(students, records)
    set.status = 200
    return { records, count: records.length }
  })
  .delete('/api/org/:auth0Id/attendance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Recording attendance requires the attendance.write permission',
        false,
      )
    }
    const url = new URL(request.url)
    const rawStudentId = url.searchParams.get('studentId')
    const sessionDate = url.searchParams.get('date')
    // Present but malformed is a 400, not a 500 from the ::uuid/::date casts.
    const studentId = pickUuid(rawStudentId)
    if (!studentId || !isDate(sessionDate)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing or invalid studentId or date', false)
    }
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, studentId)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE_MESSAGE, false)
    }
    const deleted = await deleteAttendance(auth0Id, studentId, sessionDate)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Attendance record not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
