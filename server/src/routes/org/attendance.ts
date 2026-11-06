import {
  attendanceSummary,
  deleteAttendance,
  listAttendance,
  setAttendanceBatch,
  upsertAttendance,
} from '../../lib/orgAttendance'
import type { AttendanceStatus } from '../../lib/orgEnums'
import { getStudent } from '../../lib/orgRoster'
import { isDate } from '../../lib/orgValidate'
import { ATTENDANCE_STATUS_SET } from './shared'
import { badRequest, buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { authorizeOrg } from '../../lib/orgRoute'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Attendance ─────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/attendance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const auth = await authorizeOrg(request, auth0Id, 'team.read')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
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
    const auth = await authorizeOrg(request, auth0Id, 'team.read')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const url = new URL(request.url)
    const summary = await attendanceSummary(auth0Id, {
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      studentId: url.searchParams.get('studentId') ?? undefined,
    })
    set.status = 200
    return { summary }
  })
  .put('/api/org/:auth0Id/attendance', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const auth = await authorizeOrg(request, auth0Id, 'attendance.mark')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const { student_id, session_date, status, note } = body as Record<string, unknown>
    if (!student_id || !session_date || !ATTENDANCE_STATUS_SET.has(status as string)) {
      return badRequest(set, 'Missing or invalid attendance fields')
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
  .post('/api/org/:auth0Id/attendance/batch', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const auth = await authorizeOrg(request, auth0Id, 'attendance.mark')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const { entries } = body as { entries?: unknown[] }
    if (!Array.isArray(entries) || entries.length === 0) {
      return badRequest(set, 'entries must be a non-empty array')
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
      return badRequest(set, 'Entry requires a valid student_id, session_date (YYYY-MM-DD) and status')
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
    const auth = await authorizeOrg(request, auth0Id, 'attendance.mark')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    const sessionDate = url.searchParams.get('date')
    if (!studentId || !sessionDate) {
      return badRequest(set, 'Missing studentId or date')
    }
    const deleted = await deleteAttendance(auth0Id, studentId, sessionDate)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Attendance record not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
