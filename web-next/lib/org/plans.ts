// ── Org plans subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'

// ── Training plans ─────────────────────────────────────────────────────────

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

export const orgPlans = async (
  auth0Id: string,
  opts: { teamId?: string | null; studentId?: string | null } = {},
): Promise<{ plans: TrainingPlan[] }> => {
  const params = new URLSearchParams()
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.studentId) params.set('student_id', opts.studentId)
  const qs = params.toString()
  return queryJson<{ plans: TrainingPlan[] }>(orgUrl(auth0Id, `/plans${qs ? `?${qs}` : ''}`))
}

export const orgCreatePlan = async (
  auth0Id: string,
  input: {
    team_id?: string | null
    student_id?: string | null
    title: string
    description?: string | null
  },
): Promise<{ plan: TrainingPlan }> =>
  mutateJson<{ plan: TrainingPlan }>(orgUrl(auth0Id, '/plans'), 'POST', pickDefined(input))

export const orgSetPlanStatus = async (
  auth0Id: string,
  id: string,
  status: 'active' | 'done' | 'archived',
): Promise<{ plan: TrainingPlan }> =>
  mutateJson<{ plan: TrainingPlan }>(orgUrl(auth0Id, `/plans/${encodeURIComponent(id)}`), 'PATCH', {
    status,
  })

export const orgDeletePlan = async (auth0Id: string, id: string): Promise<{ deleted: boolean }> =>
  mutateJson<{ deleted: boolean }>(orgUrl(auth0Id, `/plans/${encodeURIComponent(id)}`), 'DELETE')
