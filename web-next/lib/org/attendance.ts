// ── Org attendance subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type {
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummary,
  AttendanceWithStudent,
} from './types'

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
    orgUrl(auth0Id, `/attendance${qs ? `?${qs}` : ''}`),
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
    orgUrl(auth0Id, `/attendance/summary${qs ? `?${qs}` : ''}`),
  )
}

export const orgUpsertAttendance = async (
  auth0Id: string,
  input: { student_id: string; session_date: string; status: AttendanceStatus; note?: string },
): Promise<{ record: AttendanceRecord }> => {
  return mutateJson<{ record: AttendanceRecord }>(orgUrl(auth0Id, '/attendance'), 'PUT', input)
}

export const orgBatchAttendance = async (
  auth0Id: string,
  entries: { student_id: string; session_date: string; status: AttendanceStatus; note?: string }[],
): Promise<{ records: AttendanceRecord[]; count: number }> => {
  return mutateJson<{ records: AttendanceRecord[]; count: number }>(
    orgUrl(auth0Id, '/attendance/batch'),
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
    orgUrl(
      auth0Id,
      `/attendance?studentId=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}`,
    ),
    'DELETE',
  )
}
