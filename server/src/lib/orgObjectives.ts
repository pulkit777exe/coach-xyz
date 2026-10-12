// ── Org objectives slice (vertical slice: coaching work) ────────────────────
// Training objectives, training plans, and wellness check-ins. Pure move from
// lib/orgData.ts — all names and signatures are unchanged. Scope guards reuse
// the roster slice (getStudent) so there is a single student-lookup path.
import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from './orgStore'
import { getTeam } from './teams'
import { getStudent } from './orgRoster'

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
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
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
): Promise<WellnessCheckin | null> => {
  const student = await getStudent(auth0Id, input.student_id)
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
