// Training plans data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'
import { getStudent } from './students'
import { getTeam } from '../teams'

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

export const listTrainingPlans = async (
  auth0Id: string,
  opts: { teamId?: string | null; studentId?: string | null } = {},
): Promise<TrainingPlan[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<TrainingPlan[]>`
      select * from training_plans
      where org_auth0_id = ${auth0Id}
        and (${opts.teamId ?? null}::uuid is null or team_id = ${opts.teamId ?? null}::uuid)
        and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
      order by created_at desc;
    `
      return rows ?? []
    })) ?? []
  )
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
      delete from training_plans where org_auth0_id = ${auth0Id} and id = ${id} returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
