// Wellness check-ins (health data, §5) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { getStudent } from './students'
import { uuidArrayLiteral, type StudentScope } from './scope'

// ── Wellness check-ins (health data, §5) ─────────────────────────────────────

export type WellnessCheckin = {
  id: string
  org_auth0_id: string
  student_id: string
  sleep_hours: number | null
  fatigue: number | null
  pain: string | null
  availability: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export const listWellness = async (
  auth0Id: string,
  studentId: string,
  limit = 30,
): Promise<WellnessCheckin[]> => {
  const capped = Math.min(Math.max(limit, 1), 200)
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<WellnessCheckin[]>`
      select * from wellness_checkins
      where org_auth0_id = ${auth0Id} and student_id = ${studentId}::uuid
      order by created_at desc
      limit ${capped};
    `
      return rows ?? []
    })) ?? []
  )
}

/**
 * Wellness check-ins for a whole roster, in ONE round trip.
 *
 * This exists because `listWellness` per student does not scale to a bundle:
 * `buildOrgExport` capped its roster at 2000 students and fanned out
 * `roster.map(student => listWellness(...))`, so one export was up to 2000
 * queries. `Promise.all` made it a concurrency problem rather than a stall, but
 * against a `max: 5` pool it still serialised 2000 deep and competed with live
 * traffic on the same pool.
 *
 * `uuidArrayLiteral`, because a raw JS array reaches `any($1)` as comma-joined
 * TEXT and the `::uuid[]` cast dies with 22P02 — the opposite binding from
 * `batchRows`, and the two must not be unified (see `batchRows`).
 *
 * ORDERING is part of the contract, not an implementation detail: rows come back
 * grouped by `student_id` and, within a student, newest first — exactly what N
 * separate `order by created_at desc limit N` queries produced.
 * `row_number() over (partition by student_id …)` carries the per-student cap, so
 * this is the same N-newest rule and not "all of them"; `distinct on` would have
 * kept every row and then needed a second ranking pass anyway. The column list is
 * spelled out because the ranking column has to be dropped before the row leaves —
 * it is `listWellness`'s `select *`, in DDL order.
 */
export const listWellnessForStudents = async (
  auth0Id: string,
  studentIds: readonly string[],
  limitPerStudent = 30,
): Promise<WellnessCheckin[]> => {
  // Short-circuit rather than binding an empty `{}`: `= any('{}')` is valid and
  // matches nothing, but the round trip is still spent, and this is the shape a
  // caller hits for an org with no players.
  const ids = [...new Set(studentIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return []
  const capped = Math.min(Math.max(limitPerStudent, 1), 200)
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<WellnessCheckin[]>`
        select id, org_auth0_id, student_id, sleep_hours, fatigue, pain,
               availability, note, created_by, created_at
        from (
          select w.*, row_number() over (
            partition by student_id order by created_at desc
          ) as rn
          from wellness_checkins w
          where org_auth0_id = ${auth0Id}
            and student_id = any(${uuidArrayLiteral(ids)}::uuid[])
        ) ranked
        where ranked.rn <= ${capped}
        order by ranked.student_id;
      `
      return rows ?? []
    })) ?? []
  )
}

/**
 * Group a batched wellness read back onto its students, newest first within each.
 *
 * The rows arrive keyed by `student_id`; a caller wants them keyed by the roster
 * it asked about, so this is the client-side group-by that replaces the fan-out.
 * A `Map` keyed by id, not a `find` per row: the export's roster is capped at
 * 2000 and the result at 2000 × the per-student cap.
 */
export const groupWellnessByStudent = (
  studentIds: readonly string[],
  rows: readonly WellnessCheckin[],
): Map<string, WellnessCheckin[]> => {
  const byStudent = new Map<string, WellnessCheckin[]>()
  for (const row of rows) {
    const bucket = byStudent.get(row.student_id)
    if (bucket) bucket.push(row)
    else byStudent.set(row.student_id, [row])
  }
  // Every requested id gets an entry, so a student with no check-ins reads as an
  // empty list rather than a missing key.
  for (const id of studentIds) if (!byStudent.has(id)) byStudent.set(id, [])
  return byStudent
}

/**
 * Record a wellness check-in for one student.
 *
 * `scope` is the caller's roster visibility (`lib/org/scope.ts`), passed
 * straight into the student lookup: a check-in for a player outside the
 * caller's teams finds no student and writes nothing. The route refuses that
 * case with 403 first — this is the second line for health data, where a
 * record that lands is the thing we must never do by accident.
 */
export const createWellnessCheckin = async (
  auth0Id: string,
  createdBy: string | null,
  input: {
    student_id: string
    sleep_hours?: number | null
    fatigue?: number | null
    pain?: string | null
    availability?: string | null
    note?: string | null
  },
  scope?: StudentScope,
): Promise<WellnessCheckin | null> => {
  const student = await getStudent(auth0Id, input.student_id, scope)
  if (!student) return null
  const sleep =
    typeof input.sleep_hours === 'number' && input.sleep_hours >= 0 && input.sleep_hours <= 24
      ? input.sleep_hours
      : null
  const fatigue =
    Number.isInteger(input.fatigue) &&
    (input.fatigue as number) >= 1 &&
    (input.fatigue as number) <= 5
      ? input.fatigue
      : null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<WellnessCheckin[]>`
      insert into wellness_checkins (
        org_auth0_id, student_id, sleep_hours, fatigue, pain,
        availability, note, created_by
      ) values (
        ${auth0Id},
        ${input.student_id}::uuid,
        ${sleep},
        ${fatigue},
        ${typeof input.pain === 'string' ? input.pain.trim().slice(0, 500) || null : null},
        ${typeof input.availability === 'string' ? input.availability.trim().slice(0, 60) || null : null},
        ${typeof input.note === 'string' ? input.note.trim().slice(0, 2000) || null : null},
        ${createdBy}
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}
