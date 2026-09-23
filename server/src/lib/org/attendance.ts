// Attendance data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'
import type { AttendanceStatus } from '../orgEnums'

export type AttendanceRecord = {
  id: string
  auth0_id: string
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

export type AttendanceSummary = {
  total_records: number
  present: number
  absent: number
  late: number
  excused: number
  attendance_rate: number | null
}

// ── Attendance ───────────────────────────────────────────────────────────────
export const listAttendance = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<AttendanceWithStudent[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<AttendanceWithStudent[]>`
        select a.*, s.full_name, s.sport
        from attendance a
        join students s on s.id = a.student_id
        where a.auth0_id = ${auth0Id}
          and (${opts.from ?? null}::date is null or a.session_date >= ${opts.from ?? null}::date)
          and (${opts.to ?? null}::date is null or a.session_date <= ${opts.to ?? null}::date)
          and (${opts.studentId ?? null}::uuid is null or a.student_id = ${opts.studentId ?? null}::uuid)
        order by a.session_date desc, s.full_name asc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const upsertAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
  status: AttendanceStatus,
  note?: string | null,
): Promise<AttendanceRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<AttendanceRecord[]>`
      insert into attendance (auth0_id, student_id, session_date, status, note)
      values (${auth0Id}, ${studentId}, ${sessionDate}::date, ${status}, ${note || null})
      on conflict (auth0_id, student_id, session_date) do update set
        status = excluded.status,
        note = excluded.note,
        updated_at = now()
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const setAttendanceBatch = async (
  auth0Id: string,
  entries: {
    studentId: string
    sessionDate: string
    status: AttendanceStatus
    note?: string | null
  }[],
): Promise<AttendanceRecord[]> => {
  const results: AttendanceRecord[] = []
  for (const entry of entries) {
    const record = await upsertAttendance(
      auth0Id,
      entry.studentId,
      entry.sessionDate,
      entry.status,
      entry.note,
    )
    if (record) results.push(record)
  }
  return results
}

export const deleteAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from attendance
      where auth0_id = ${auth0Id} and student_id = ${studentId} and session_date = ${sessionDate}::date
      returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const attendanceSummary = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<AttendanceSummary> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<AttendanceSummary[]>`
        select
          count(*)::int as total_records,
          count(*) filter (where status = 'present')::int as present,
          count(*) filter (where status = 'absent')::int as absent,
          count(*) filter (where status = 'late')::int as late,
          count(*) filter (where status = 'excused')::int as excused,
          case when count(*) = 0 then null
               else round((count(*) filter (where status in ('present', 'late')) * 100.0) / count(*), 1)::float8
          end as attendance_rate
        from attendance
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::date is null or session_date >= ${opts.from ?? null}::date)
          and (${opts.to ?? null}::date is null or session_date <= ${opts.to ?? null}::date)
          and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid);
      `
      return (
        rows?.[0] ?? {
          total_records: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          attendance_rate: null,
        }
      )
    })) ?? {
      total_records: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      attendance_rate: null,
    }
  )
}
