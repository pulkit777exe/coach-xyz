// Training objectives data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { getStudent } from './students'
import { getTeam } from '../teams'
import { canSeeStudent, uuidArrayLiteral, type StudentScope } from './scope'

export type TrainingObjective = {
  id: string
  org_auth0_id: string
  student_id: string | null
  team_id: string | null
  finding_id: string | null
  analysis_job_id: string | null
  title: string
  description: string | null
  status: 'active' | 'done' | 'archived'
  due_on: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ObjectiveInput = {
  student_id?: string | null
  team_id?: string | null
  finding_id?: string | null
  analysis_job_id?: string | null
  title: string
  description?: string | null
  due_on?: string | null
}

const OBJECTIVE_STATUSES = ['active', 'done', 'archived'] as const

/**
 * Team scope for objective reads. A `training_objectives` row is team-level
 * (`team_id` set, `student_id` null), student-level (`student_id` set) or
 * org-level (both null), so a scoped caller sees a row when the row's OWN team
 * is one of its teams OR its student is a visible student. Testing only one of
 * the two columns is wrong in both directions: the student-only test hides a
 * team-level objective from the coach who owns that team, and the team-only
 * test leaks a student-level objective to every coach on the student's team.
 *
 * `scope` absent = org-wide (owner/admin, and the org-wide readers
 * analyst/medical). Present = the caller's teams and visible students, and it
 * stays meaningful when EMPTY: an unassigned coach must match nothing.
 */
export type ObjectiveScope = { teamIds: string[]; studentIds: string[] }

/**
 * The pure half of that rule, for the write paths that fetch-then-check a row.
 * Same answer as the SQL filter in `listObjectives`, so a PATCH/DELETE refusal
 * and a list refusal can never disagree.
 */
export const objectiveVisibleTo = (
  scope: StudentScope,
  studentIds: string[] | null,
  target: { team_id: string | null; student_id: string | null },
): boolean => {
  if (scope.all) return true
  if (target.team_id && scope.teamIds.includes(target.team_id)) return true
  // Both columns null is org-level, which no scoped caller may touch.
  return target.student_id !== null && canSeeStudent(studentIds, target.student_id)
}

export const listObjectives = async (
  auth0Id: string,
  opts: {
    studentId?: string | null
    teamId?: string | null
    status?: string | null
    scope?: ObjectiveScope
    limit?: number
  } = {},
): Promise<TrainingObjective[]> => {
  const scoped = opts.scope !== undefined
  // Both id lists bind through `uuidArrayLiteral` (the shared owner of
  // `= any(...::uuid[])`): a raw JS array reaches Postgres as comma-joined text
  // and the cast fails with `22P02`. An empty scope binds NULL, and the
  // `coalesce` keeps the OR chain boolean when a NULL column meets a NULL array.
  const teamParam =
    opts.scope && opts.scope.teamIds.length > 0 ? uuidArrayLiteral(opts.scope.teamIds) : null
  const studentParam =
    opts.scope && opts.scope.studentIds.length > 0 ? uuidArrayLiteral(opts.scope.studentIds) : null
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<TrainingObjective[]>`
      select *
      from training_objectives
      where org_auth0_id = ${auth0Id}
        and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
        and (${opts.teamId ?? null}::uuid is null or team_id = ${opts.teamId ?? null}::uuid)
        and (${opts.status ?? null}::text is null or status = ${opts.status ?? null})
        and (not ${scoped}
             or coalesce(team_id = any(${teamParam}::uuid[]), false)
             or coalesce(student_id = any(${studentParam}::uuid[]), false))
      order by created_at desc
      limit ${(opts.limit === undefined ? null : Math.min(Math.max(opts.limit, 1), 10000)) as number | null};
    `
      return rows ?? []
    })) ?? []
  )
}

/**
 * Does an org own this analysis? `analysis_history` rows are owned by an org
 * through `auth0_id` — the `server_job_id` itself is a caller-supplied text
 * primary key, so existence proves nothing and only the org predicate does.
 *
 * This is the same loose-link shape as `students.team_id` (see the entry on
 * `deleteTeam`): a uuid that is unique globally, a column with no foreign key,
 * and a row that a caller can therefore aim at another tenant's data. The
 * objective itself is org-scoped (`listObjectives` filters `org_auth0_id`), so
 * without this a foreign `analysis_job_id` was stored and read back — the leak
 * is in the stored pointer, not in the list.
 */
export const analysisBelongsToOrg = async (
  auth0Id: string,
  serverJobId: string,
): Promise<boolean> => {
  const rows = await withHistoryStoreOrThrow(async (db) => {
    return db<{ n: number }[]>`
      select count(*)::int as n from analysis_history
      where auth0_id = ${auth0Id} and server_job_id = ${serverJobId};
    `
  })
  return (rows?.[0]?.n ?? 0) > 0
}

/**
 * Does an org own this finding? `findings` carries no org column at all — it is
 * reachable only by joining to `analysis_history.auth0_id`, which is what makes
 * the org predicate here non-optional. And because `findings_unique` is
 * `(server_job_id, id)`, the same finding id CAN exist under two analyses in two
 * orgs, so "a row with this id exists" would be satisfied by the victim's copy
 * while the caller meant their own.
 */
export const findingBelongsToOrg = async (auth0Id: string, findingId: string): Promise<boolean> => {
  const rows = await withHistoryStoreOrThrow(async (db) => {
    return db<{ n: number }[]>`
      select count(*)::int as n
      from findings f
      join analysis_history a on a.server_job_id = f.server_job_id
      where a.auth0_id = ${auth0Id} and f.id = ${findingId};
    `
  })
  return (rows?.[0]?.n ?? 0) > 0
}

/**
 * One objective by id, UNSCOPED. The PATCH/DELETE handlers must be able to tell
 * "no such objective" (404) from "not yours" (403), so they read the row first
 * and then apply `objectiveVisibleTo` — a scoped read would collapse both into
 * a 404 and turn the refusal into an existence oracle in the other direction.
 */
export const getObjective = async (
  auth0Id: string,
  id: string,
): Promise<TrainingObjective | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingObjective[]>`
      select * from training_objectives where org_auth0_id = ${auth0Id} and id = ${id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const createObjective = async (
  auth0Id: string,
  createdBy: string | null,
  input: ObjectiveInput,
): Promise<TrainingObjective | null> => {
  const title = input.title.trim().slice(0, 200)
  if (!title) return null
  // Scope guard: linked student/team must belong to this org.
  if (input.student_id) {
    const student = await getStudent(auth0Id, input.student_id)
    if (!student) return null
  }
  if (input.team_id) {
    const team = await getTeam(auth0Id, input.team_id)
    if (!team) return null
  }
  // Normalized ONCE, and the same value is both checked and written. Validating
  // `input.finding_id?.trim()` while inserting `input.finding_id?.slice(0, 200)`
  // would leave the two disagreeing — a blank string skips the check and still
  // stores `'   '`, and a >200-char id would be validated whole and stored
  // truncated, i.e. validated as something other than what lands in the column.
  const findingId = input.finding_id?.trim().slice(0, 200) || null
  const analysisJobId = input.analysis_job_id?.trim().slice(0, 200) || null
  // Same rule as the student/team guards above, for the two analysis-linked
  // columns. `findings.id` is only unique PER ANALYSIS
  // (`unique (server_job_id, id)`), so a bare finding id is not even globally
  // unique — it needs the org-scoped join to mean anything at all. Both are
  // checked rather than assumed because `training_objectives` stores them as
  // free text with no foreign key, so an unvalidated value is a cross-tenant
  // POINTER: the objective row itself stays org-scoped (which is why this is
  // data integrity rather than a read leak), but the stored id can then be used
  // to probe whether a given server_job_id or finding id exists elsewhere, and
  // another tenant's finding can be attached to this one.
  if (analysisJobId && !(await analysisBelongsToOrg(auth0Id, analysisJobId))) return null
  if (findingId && !(await findingBelongsToOrg(auth0Id, findingId))) return null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingObjective[]>`
      insert into training_objectives (
        org_auth0_id, student_id, team_id, finding_id, analysis_job_id,
        title, description, due_on, created_by
      ) values (
        ${auth0Id},
        ${input.student_id ?? null}::uuid,
        ${input.team_id ?? null}::uuid,
        ${findingId},
        ${analysisJobId},
        ${title},
        ${input.description?.trim().slice(0, 2000) || null},
        ${input.due_on ?? null}::date,
        ${createdBy}
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const setObjectiveStatus = async (
  auth0Id: string,
  id: string,
  status: string,
): Promise<TrainingObjective | null> => {
  if (!(OBJECTIVE_STATUSES as readonly string[]).includes(status)) return null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingObjective[]>`
      update training_objectives set status = ${status}, updated_at = now()
      where org_auth0_id = ${auth0Id} and id = ${id}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteObjective = async (auth0Id: string, id: string): Promise<boolean> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
      delete from training_objectives
      where org_auth0_id = ${auth0Id} and id = ${id}
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
