// Training objectives data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'
import { getStudent } from './students'
import { getTeam } from '../teams'

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

export const listObjectives = async (
  auth0Id: string,
  opts: { studentId?: string | null; teamId?: string | null; status?: string | null } = {},
): Promise<TrainingObjective[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<TrainingObjective[]>`
      select *
      from training_objectives
      where org_auth0_id = ${auth0Id}
        and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
        and (${opts.teamId ?? null}::uuid is null or team_id = ${opts.teamId ?? null}::uuid)
        and (${opts.status ?? null}::text is null or status = ${opts.status ?? null})
      order by created_at desc;
    `
      return rows ?? []
    })) ?? []
  )
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<TrainingObjective[]>`
      insert into training_objectives (
        org_auth0_id, student_id, team_id, finding_id, analysis_job_id,
        title, description, due_on, created_by
      ) values (
        ${auth0Id},
        ${input.student_id ?? null}::uuid,
        ${input.team_id ?? null}::uuid,
        ${input.finding_id?.slice(0, 200) ?? null},
        ${input.analysis_job_id?.slice(0, 200) ?? null},
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
      delete from training_objectives
      where org_auth0_id = ${auth0Id} and id = ${id}
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
