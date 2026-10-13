// ── Org objectives subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'

// ── Training objectives (§26 loop) ──────────────────────────────────────────
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

export const orgObjectives = async (
  auth0Id: string,
  opts: { studentId?: string; teamId?: string; status?: string } = {},
): Promise<{ objectives: TrainingObjective[] }> => {
  const params = new URLSearchParams()
  if (opts.studentId) params.set('student_id', opts.studentId)
  if (opts.teamId) params.set('team_id', opts.teamId)
  if (opts.status) params.set('status', opts.status)
  const qs = params.toString()
  return queryJson<{ objectives: TrainingObjective[] }>(
    orgUrl(auth0Id, `/objectives${qs ? `?${qs}` : ''}`),
  )
}

export const orgCreateObjective = async (
  auth0Id: string,
  input: {
    student_id?: string | null
    team_id?: string | null
    finding_id?: string | null
    analysis_job_id?: string | null
    title: string
    description?: string | null
    due_on?: string | null
  },
): Promise<{ objective: TrainingObjective }> => {
  return mutateJson<{ objective: TrainingObjective }>(
    orgUrl(auth0Id, '/objectives'),
    'POST',
    pickDefined(input),
  )
}

export const orgSetObjectiveStatus = async (
  auth0Id: string,
  id: string,
  status: 'active' | 'done' | 'archived',
): Promise<{ objective: TrainingObjective }> => {
  return mutateJson<{ objective: TrainingObjective }>(
    orgUrl(auth0Id, `/objectives/${encodeURIComponent(id)}`),
    'PATCH',
    { status },
  )
}

export const orgDeleteObjective = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    orgUrl(auth0Id, `/objectives/${encodeURIComponent(id)}`),
    'DELETE',
  )
}
