// Training plans data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { getStudent } from './students'
import { getTeam } from '../teams'
import { canSeeStudent, uuidArrayLiteral, type StudentScope } from './scope'

// ── Training plans ───────────────────────────────────────────────────────────

export type TrainingPlan = {
  id: string
  org_auth0_id: string
  team_id: string | null
  student_id: string | null
  title: string
  description: string | null
  status: 'active' | 'done' | 'archived'
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Team scope for plan reads — the same team_id-OR-student_id rule the
 * `listTrainingPlans` filter expresses in SQL. `scope` is the narrowing the
 * caller's `studentScope` produced; absent means org-wide.
 */
export type TrainingPlanScope = { teamIds: string[]; studentIds: string[] }

/**
 * The pure half of the read rule, for the write paths that fetch-then-check a
 * row, so a refusal and the list filter can never disagree.
 */
export const planVisibleTo = (
  scope: StudentScope,
  studentIds: string[] | null,
  target: { team_id: string | null; student_id: string | null },
): boolean => {
  if (scope.all) return true
  if (target.team_id && scope.teamIds.includes(target.team_id)) return true
  // Both columns null is org-level, which no scoped caller may touch.
  return target.student_id !== null && canSeeStudent(studentIds, target.student_id)
}

export const listTrainingPlans = async (
  auth0Id: string,
  opts: { teamId?: string | null; studentId?: string | null; scope?: TrainingPlanScope; limit?: number } = {},
): Promise<TrainingPlan[]> => {
  // A training_plans row is team-level (team_id set, student_id null),
  // student-level (student_id set) or org-level (both null), so a scoped caller
  // sees it when the row's OWN team is one of its teams OR its student is a
  // visible student. Checking one column only would hide a team-level plan from
  // its own team's coach, or leak a student-level plan to a coach who merely
  // shares the team. `scope` absent = org-wide (owner/admin, analyst/medical);
  // present-and-empty = an unassigned coach, who must match nothing.
  const scoped = opts.scope !== undefined
  // Both id lists bind through `uuidArrayLiteral` (the shared owner of
  // `= any(...::uuid[])`): see the same note in `listObjectives`.
  const teamParam =
    opts.scope && opts.scope.teamIds.length > 0 ? uuidArrayLiteral(opts.scope.teamIds) : null
  const studentParam =
    opts.scope && opts.scope.studentIds.length > 0 ? uuidArrayLiteral(opts.scope.studentIds) : null
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<TrainingPlan[]>`
      select * from training_plans
      where org_auth0_id = ${auth0Id}
        and (${opts.teamId ?? null}::uuid is null or team_id = ${opts.teamId ?? null}::uuid)
        and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
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
 * One plan by id, UNSCOPED — see `getObjective` for why the write paths
 * fetch-then-check instead of reading through the scoped list.
 */
export const getTrainingPlan = async (
  auth0Id: string,
  id: string,
): Promise<TrainingPlan | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingPlan[]>`
      select * from training_plans where org_auth0_id = ${auth0Id} and id = ${id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const createTrainingPlan = async (
  auth0Id: string,
  createdBy: string | null,
  input: {
    team_id?: string | null
    student_id?: string | null
    title: string
    description?: string | null
  },
): Promise<TrainingPlan | null> => {
  const title = input.title.trim().slice(0, 200)
  if (!title) return null
  if (input.student_id) {
    const student = await getStudent(auth0Id, input.student_id)
    if (!student) return null
  }
  if (input.team_id) {
    const team = await getTeam(auth0Id, input.team_id)
    if (!team) return null
  }
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingPlan[]>`
      insert into training_plans (org_auth0_id, team_id, student_id, title, description, created_by)
      values (
        ${auth0Id},
        ${input.team_id ?? null}::uuid,
        ${input.student_id ?? null}::uuid,
        ${title},
        ${input.description?.trim().slice(0, 2000) || null},
        ${createdBy}
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const setTrainingPlanStatus = async (
  auth0Id: string,
  id: string,
  status: string,
): Promise<TrainingPlan | null> => {
  if (status !== 'active' && status !== 'done' && status !== 'archived') return null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<TrainingPlan[]>`
      update training_plans set status = ${status}, updated_at = now()
      where org_auth0_id = ${auth0Id} and id = ${id}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteTrainingPlan = async (auth0Id: string, id: string): Promise<boolean> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
      delete from training_plans where org_auth0_id = ${auth0Id} and id = ${id} returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
