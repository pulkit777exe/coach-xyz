// ── Org attendance slice (vertical slice: showing up) ────────────────────────
// Attendance records (+ summary) and schedule events. Pure move from
// lib/orgData.ts — all names and signatures are unchanged.
import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from './orgStore'
import { EVENT_STATUSES, EVENT_TYPES } from './orgEnums'
import type { AttendanceStatus } from './orgEnums'

// ── Types ────────────────────────────────────────────────────────────────────

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

export type ScheduleEvent = {
  id: string
  auth0_id: string
  title: string
  event_type: (typeof EVENT_TYPES)[number]
  starts_at: string
  ends_at: string | null
  location: string | null
  description: string | null
  status: (typeof EVENT_STATUSES)[number]
  created_at: string
  updated_at: string
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

// ── Schedule ─────────────────────────────────────────────────────────────────

export const listSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<ScheduleEvent[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<ScheduleEvent[]>`
        select * from schedule_events
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::timestamptz is null or starts_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or starts_at <= ${opts.to ?? null}::timestamptz)
        order by starts_at asc;
      `
      return rows ?? []
    })) ?? []
  )
}

const scheduleInsertCols = {
  title: true,
  event_type: true,
  starts_at: true,
  ends_at: true,
  location: true,
  description: true,
  status: true,
} as const

export type ScheduleInput = Record<string, unknown>

export const createScheduleEvent = async (
  auth0Id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(scheduleInsertCols).filter(
      (k) => k in input && input[k] !== undefined && input[k] !== null && input[k] !== '',
    )
    const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ')
    const sql = `
      insert into schedule_events (auth0_id, ${cols.join(', ')})
      values (${placeholders})
      returning *;
    `
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [auth0Id, ...cols.map((k) => input[k])])
    return rows[0] ?? null
  })
}

export const updateScheduleEvent = async (
  auth0Id: string,
  id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(scheduleInsertCols).filter((k) => k in input)
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}::text`).join(', ') + (cols.length ? ', ' : '')
    const sql = `
      update schedule_events set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
      return String(v)
    })
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [...values, auth0Id, id])
    return rows[0] ?? null
  })
}

export const deleteScheduleEvent = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from schedule_events where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}
