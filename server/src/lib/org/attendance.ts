// Attendance data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { uuidArrayLiteral } from './scope'
import type { AttendanceStatus } from '../orgEnums'

/**
 * Bind pair for the student-scope filter (the list `visibleStudentIds` returns
 * in `lib/org/scope.ts`): `undefined`/`null` means org-wide and adds no
 * predicate, a list means exactly those students, and `[]` means the caller
 * sees nobody.
 *
 * The binding is the one proven in `org/students.ts`: an empty list binds NULL
 * (Bun sends `[]` as '', which is not a valid uuid[] literal) so
 * `not ${scoped} or student_id = any(NULL::uuid[])` matches no rows — the honest
 * answer for a coach who manages no team — while a non-empty list goes through
 * `uuidArrayLiteral`, because a raw JS array reaches Postgres as comma-joined
 * text and the `::uuid[]` cast then fails.
 */
const scopeFilter = (ids: string[] | null | undefined) => ({
  scoped: ids !== undefined && ids !== null,
  param: ids !== undefined && ids !== null && ids.length > 0 ? uuidArrayLiteral(ids) : null,
})

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
  opts: {
    from?: string
    to?: string
    studentId?: string
    studentIds?: string[] | null
    limit?: number
  } = {},
): Promise<AttendanceWithStudent[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const filter = scopeFilter(opts.studentIds)
      const rows = await db<AttendanceWithStudent[]>`
        select a.*, s.full_name, s.sport
        from attendance a
        join students s on s.id = a.student_id
        where a.auth0_id = ${auth0Id}
          and (${opts.from ?? null}::date is null or a.session_date >= ${opts.from ?? null}::date)
          and (${opts.to ?? null}::date is null or a.session_date <= ${opts.to ?? null}::date)
          and (${opts.studentId ?? null}::uuid is null or a.student_id = ${opts.studentId ?? null}::uuid)
          and (not ${filter.scoped} or a.student_id = any(${filter.param}::uuid[]))
        order by a.session_date desc, s.full_name asc
        limit ${(opts.limit === undefined ? null : Math.min(Math.max(opts.limit, 1), 20000)) as number | null};
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
  return withHistoryStoreOrThrow(async (db) => {
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
  if (entries.length === 0) return []
  // Collapse duplicate (student, date) pairs, last wins: a single multi-row
  // statement cannot touch the same conflict row twice ("ON CONFLICT DO
  // UPDATE command cannot affect row a second time"), and sequential upserts
  // left the last write standing, so the final state is identical.
  const byKey = new Map<string, (typeof entries)[number]>()
  for (const entry of entries) {
    byKey.set(`${entry.studentId}|${entry.sessionDate}`, entry)
  }
  const unique = [...byKey.values()]
  // One multi-row upsert instead of N sequential round trips: the route caps
  // batches at MAX_ATTENDANCE_BATCH, so one statement carries at most
  // 500 × 5 parameters — well within limits — and RETURNING * yields the
  // same rows in an order the notification fan-out re-keys by student.
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const placeholders: string[] = []
      const values: unknown[] = []
      unique.forEach((entry, i) => {
        const base = i * 5
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}::date, $${base + 4}, $${base + 5})`,
        )
        values.push(auth0Id, entry.studentId, entry.sessionDate, entry.status, entry.note ?? null)
      })
      const rows = await db.unsafe<AttendanceRecord[]>(
        `insert into attendance (auth0_id, student_id, session_date, status, note)
         values ${placeholders.join(', ')}
         on conflict (auth0_id, student_id, session_date) do update set
           status = excluded.status,
           note = excluded.note,
           updated_at = now()
         returning *;`,
        values,
      )
      return rows ?? []
    })) ?? []
  )
}

export const deleteAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
): Promise<boolean> => {
  const res = await withHistoryStoreOrThrow(async (db) => {
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
  opts: { from?: string; to?: string; studentId?: string; studentIds?: string[] | null } = {},
): Promise<AttendanceSummary> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const filter = scopeFilter(opts.studentIds)
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
          and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
          and (not ${filter.scoped} or student_id = any(${filter.param}::uuid[]));
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
