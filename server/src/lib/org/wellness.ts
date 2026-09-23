// Wellness check-ins (health data, §5) data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'
import { getStudent } from './students'

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
