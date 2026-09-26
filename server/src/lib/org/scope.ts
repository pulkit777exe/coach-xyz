// Team-scope seam for the org data layer.
//
// Reads and writes that hang off a student (attendance, reports, performance,
// objectives, plans, wellness) must all answer one question the same way: can
// this caller see that student? Resolving the scope to a list of student ids
// once per request keeps that answer in one place instead of re-deriving team
// membership inside every query, and it gives the write paths a cheap
// membership test so a scoped caller cannot reach a student outside its teams
// by guessing an id.
//
// The convention matches `listStudents`: `undefined` scope means the org is
// visible; an empty team list means nothing is.

import { withHistoryStoreOrThrow } from '../historyStore'

/** Roster visibility for one caller, as resolved by `resolveCaller`. */
export type StudentScope = { all: true } | { all: false; teamIds: string[] }

/**
 * A Postgres array literal for a list of uuids — the one way to write
 * `= any(...::uuid[])` from this client.
 *
 * Bun binds a JS array as comma-joined TEXT, so `= any(${ids}::uuid[])` sends
 * `a,b` and the cast fails with `22P02 malformed array literal` (verified
 * against a live server). Only org-wide reads escaped it, because only they skip
 * the array — which is why every scoped read crashed while unscoped reads looked
 * fine. (`db.array(ids, 'uuid')` also works, but it needs the connection inside
 * the callback and breaks every fixture that stubs `db` as a plain tag function.)
 *
 * The literal still travels as a query *parameter* — the only literal text is the
 * `::uuid[]` cast — and a uuid's text form cannot contain `,` `{}` or `"`, so this
 * is data, not SQL: no injection surface.
 */
export const uuidArrayLiteral = (ids: readonly string[]): string => `{${ids.join(',')}}`

/**
 * Ids of the students this caller may see, or `null` when the caller sees the
 * whole org. `null` is deliberately distinct from `[]`: org-wide is not the
 * same as "no students", and collapsing them would silently hide everything
 * from an unassigned coach.
 */
export const visibleStudentIds = async (
  orgAuth0Id: string,
  scope: StudentScope,
): Promise<string[] | null> => {
  if (scope.all) return null
  const teamIds = scope.teamIds.filter((t) => typeof t === 'string' && t.length > 0)
  if (teamIds.length === 0) return []
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
        select id from students
        where auth0_id = ${orgAuth0Id} and team_id = any(${uuidArrayLiteral(teamIds)}::uuid[]);
      `
      return rows ?? []
    })) ?? []
  ).map((r) => r.id)
}

/** Can the caller see this student, given ids from `visibleStudentIds`? */
export const canSeeStudent = (ids: string[] | null, studentId: string): boolean =>
  ids === null || ids.includes(studentId)
