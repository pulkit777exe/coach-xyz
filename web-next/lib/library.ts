import { mutateJson, queryJson } from './data/client'
import { authUserUrl } from './data/transport'

// ── User library client ────────────────────────────────────────────────────
// Entity facade over the data core for the dashboard user library:
// analyses, stats, findings, clips, and analysis lifecycle.

// ── Dashboard API ───────────────────────────────────────────────────────────

export type DashboardAnalysis = {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  stage: number | null
  stage_name: string | null
  progress: number | null
  complete: boolean
  video_ready: boolean
  summary_json: unknown
  error_code: string | null
  error_message: string | null
  download_count: number
  display_name: string | null
  file_name: string | null
  file_size_bytes: number | null
  player_count: number | null
  requested_at: string
  completed_at: string | null
  student_id: string | null
}

export type DashboardStats = {
  total_analyses: number
  completed_analyses: number
  in_progress_analyses: number
  failed_analyses: number
  total_downloads: number
}

export async function getDashboardAnalyses(
  auth0Id: string,
  limit = 20,
  offset = 0,
  opts: { unlinked?: boolean } = {},
): Promise<{ analyses: DashboardAnalysis[] }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (opts.unlinked) params.set('unlinked', '1')
  return queryJson<{ analyses: DashboardAnalysis[] }>(
    authUserUrl(auth0Id, `/analyses?${params.toString()}`),
  )
}

export async function getDashboardAnalysisDetail(
  auth0Id: string,
  jobId: string,
): Promise<{ analysis: DashboardAnalysis }> {
  return queryJson<{ analysis: DashboardAnalysis }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}`),
  )
}

export async function getDashboardStats(auth0Id: string): Promise<{ stats: DashboardStats }> {
  return queryJson<{ stats: DashboardStats }>(authUserUrl(auth0Id, '/stats'))
}

export type FindingsTrendPoint = {
  day: string
  category: string
  count: number
  needs_review: number
}

export async function getFindingsTrends(
  auth0Id: string,
  opts: {
    days?: number
    category?: string | null
    severity?: string | null
    studentId?: string | null
    teamId?: string | null
  } = {},
): Promise<{ trends: FindingsTrendPoint[] }> {
  const params = new URLSearchParams()
  if (opts.days !== undefined) params.set('days', String(opts.days))
  if (opts.category) params.set('category', opts.category)
  if (opts.severity) params.set('severity', opts.severity)
  if (opts.studentId) params.set('student_id', opts.studentId)
  if (opts.teamId) params.set('team_id', opts.teamId)
  const qs = params.toString()
  return queryJson<{ trends: FindingsTrendPoint[] }>(
    authUserUrl(auth0Id, `/findings/trends${qs ? `?${qs}` : ''}`),
  )
}

export async function reviewFinding(
  auth0Id: string,
  findingId: string,
  reviewState: 'approved' | 'flagged',
): Promise<{ id: string; review_state: string }> {
  return mutateJson<{ id: string; review_state: string }>(
    authUserUrl(auth0Id, `/findings/${encodeURIComponent(findingId)}`),
    'PATCH',
    { review_state: reviewState },
  )
}

export type Clip = {
  id: string
  server_job_id: string
  finding_id: string | null
  label: string
  start_ms: number
  end_ms: number
  created_by: string | null
  created_at: string
}

export async function listClips(auth0Id: string, jobId: string): Promise<{ clips: Clip[] }> {
  return queryJson<{ clips: Clip[] }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/clips`),
  )
}

export async function createClip(
  auth0Id: string,
  jobId: string,
  input: { label: string; start_ms: number; end_ms: number; finding_id?: string | null },
): Promise<{ clip: Clip }> {
  return mutateJson<{ clip: Clip }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/clips`),
    'POST',
    input,
  )
}

export async function deleteClip(
  auth0Id: string,
  jobId: string,
  clipId: string,
): Promise<{ deleted: boolean }> {
  return mutateJson<{ deleted: boolean }>(
    authUserUrl(
      auth0Id,
      `/analyses/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}`,
    ),
    'DELETE',
  )
}

export const cancelAnalysis = async (
  auth0Id: string,
  jobId: string,
): Promise<{ cancelled: boolean }> => {
  return mutateJson<{ cancelled: boolean }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/cancel`),
    'POST',
  )
}

export const deleteAnalysis = async (
  auth0Id: string,
  jobId: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}`),
    'DELETE',
  )
}

export const renameAnalysis = async (
  auth0Id: string,
  jobId: string,
  displayName: string,
): Promise<{ analysis: DashboardAnalysis }> => {
  return mutateJson<{ analysis: DashboardAnalysis }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}`),
    'PATCH',
    { display_name: displayName },
  )
}
