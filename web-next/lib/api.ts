import type { ScanResult, JobStatus, CoachAIError, UploadProgress, ChatMessage } from '@/types'

import { attributionStore } from './data/attribution'
import {
  mutateJson,
  postJob,
  postPresigned,
  queryJson,
  requestJson,
  streamJson,
  uploadXhr,
  withTimeout,
} from './data/client'
import {
  authUserUrl,
  capabilityBase,
  capabilityUrl,
  downloadPath,
  identityBase,
  identityUrl,
} from './data/transport'

if (!capabilityBase()) {
  console.error('Missing NEXT_PUBLIC_API_URL environment variable. API calls will fail.')
}

// Identity-bearing routes (org + auth/user) always go through the verified
// identity boundary:
//  - server-side (server components): backend directly, with service headers
//    injected in the data core
//  - client-side: the same-origin Next proxy (/api/service), which verifies
//    the session and injects those headers
export const IDENTITY_BASE: string = identityBase()

export type { CoachAIError }

// ── API Client ───────────────────────────────────────────────────────────────
// Thin facade over the data core (`lib/data/*`): generic query/mutate/stream/
// upload over an injected transport with one centralized error taxonomy.
// Signatures here never change — 40+ importers depend on them.

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  isFormData = false,
): Promise<T> {
  return requestJson<T>(url, options, isFormData)
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch a short-lived attribution token binding the verified session sub.
 * Browser-direct capability routes (scan/analyze/status/chat/conversation)
 * receive it as `x-attribution` so the backend can attribute uploads to the
 * signed-in caller without trusting a raw client header. Cached in the data
 * core until expiry to avoid an extra round-trip per scan/analyze pair.
 */
export async function getAttributionToken(): Promise<string | null> {
  return attributionStore.getToken()
}

export async function scanVideoWithProgress(
  file: File,
  onProgress: (progress: UploadProgress) => void,
  auth0Id?: string | null,
  opts: { sessionToken?: string | null; angle?: string | null } = {},
): Promise<ScanResult> {
  // Best-effort attribution: only set the header when a signed token is
  // available. The token method returns a GET through the identity proxy so it
  // is never blocked by upload size limits; the server ignores it otherwise.
  const token = auth0Id ? await getAttributionToken() : null
  const headers: Record<string, string> = token ? { 'x-attribution': token } : {}

  // Intent-first (§8): validate metadata + mint a namespaced key before any
  // bytes move. On the S3 backend the browser uploads straight to storage
  // (presigned POST) and finishes with scan-from-key; on local the intent
  // carries the session/angle into the existing multipart path.
  const intent = await requestScanIntent(file, auth0Id, opts, headers)
  if (intent.upload.mode === 'presigned') {
    await postPresigned(file, intent.upload.url, intent.upload.fields, onProgress)
    return scanFromKey(intent, auth0Id, headers)
  }

  // Multi-angle flow: append to an existing session under a labeled angle.
  const formFields: Record<string, string> = {}
  if (opts.sessionToken) formFields.session_token = opts.sessionToken
  if (opts.angle) formFields.angle = opts.angle
  return uploadXhr<ScanResult>({
    url: capabilityUrl('/api/scan-video'),
    file,
    fieldName: 'video',
    formFields,
    headers,
    onProgress,
  })
}

export type UploadIntent =
  | {
      key: string
      session_token: string
      angle: string
      upload: { mode: 'multipart'; scan_url: string }
    }
  | {
      key: string
      session_token: string
      angle: string
      upload: { mode: 'presigned'; url: string; fields: Record<string, string> }
    }

export async function requestScanIntent(
  file: File,
  auth0Id?: string | null,
  opts: { sessionToken?: string | null; angle?: string | null } = {},
  extraHeaders: Record<string, string> = {},
): Promise<UploadIntent> {
  return mutateJson<UploadIntent>(
    capabilityUrl('/api/scan-intent'),
    'POST',
    {
      filename: file.name || 'video.mp4',
      mime_type: file.type,
      size_bytes: file.size,
      session_token: opts.sessionToken ?? null,
      angle: opts.angle ?? null,
    },
    { headers: extraHeaders },
  )
}

export async function scanFromKey(
  intent: UploadIntent,
  auth0Id?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<ScanResult> {
  void auth0Id
  return mutateJson<ScanResult>(
    capabilityUrl('/api/scan-from-key'),
    'POST',
    {
      storage_key: intent.key,
      session_token: intent.session_token,
      angle: intent.angle,
    },
    { headers: extraHeaders },
  )
}

export type ScanProgressEvent = {
  session_token: string
  angle?: string
  current: number
  total: number
  complete: boolean
  error: string | null
}

/**
 * Stream scan progress via SSE. Yields ScanProgressEvents as they arrive.
 * Pass an AbortSignal to cancel the stream on unmount.
 */
export async function* streamScanProgress(
  sessionToken: string,
  signal?: AbortSignal,
  angle?: string | null,
): AsyncGenerator<ScanProgressEvent> {
  const url = angle
    ? capabilityUrl(`/api/scan-progress/${sessionToken}?angle=${encodeURIComponent(angle)}`)
    : capabilityUrl(`/api/scan-progress/${sessionToken}`)
  yield* streamJson<ScanProgressEvent>(
    url,
    { signal },
    {
      failureCode: 'SCAN_PROGRESS_FAILED',
      failureMessage: 'Failed to get scan progress.',
    },
  )
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
  angle?: string | null
  auth0Id?: string | null
}): Promise<{ job_id: string }> {
  const { auth0Id, ...rest } = params
  const attribution = auth0Id ? await getAttributionToken() : null
  return postJob(
    capabilityUrl('/api/analyze-video'),
    {
      ...rest,
      model: 'gemini-2.5-flash',
    },
    {
      timeoutMs: 30_000, // 30s for enqueue
      headers: attribution ? { 'x-attribution': attribution } : {},
    },
  )
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return withTimeout(15_000, async (signal) => {
    // Owned jobs require the caller's signed sub — attach best-effort
    // attribution so status polls keep working after the ownership binding.
    // Anonymous jobs stay readable without it.
    const attribution = await getAttributionToken().catch(() => null)
    return queryJson<JobStatus>(capabilityUrl(`/api/job-status/${jobId}`), {
      signal,
      headers: attribution ? { 'x-attribution': attribution } : {},
    })
  })
}

export function getDownloadUrl(jobId: string): string {
  return downloadPath(jobId)
}

/**
 * Headerless consumers (`<video src>`, `<a href>`, `window.location.href`)
 * cannot send `x-attribution`, so owned-job downloads carry the signed token
 * as an `?attribution=` query param instead — the server verifies it exactly
 * like the header. Anonymous jobs need no token; the base URL is returned.
 */
export async function getAuthorizedDownloadUrl(jobId: string): Promise<string> {
  const base = getDownloadUrl(jobId)
  const token = await getAttributionToken().catch(() => null)
  return token ? `${base}?attribution=${encodeURIComponent(token)}` : base
}

// ── Chat API ─────────────────────────────────────────────────────────────────

export type { ChatMessage } from '@/types'

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; text: string; timestamp_refs: number[]; event_refs: number[] }
  | { type: 'error'; message: string }

/**
 * Stream a chat message via SSE. Yields parsed StreamEvents as they arrive.
 * Pass an AbortSignal to cancel the stream on unmount or user action.
 */
export async function* sendChatMessageStream(
  jobId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const attribution = await getAttributionToken().catch(() => null)
  yield* streamJson<StreamEvent>(
    capabilityUrl('/api/chat/stream'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(attribution ? { 'x-attribution': attribution } : {}),
      },
      body: JSON.stringify({ job_id: jobId, message }),
      signal,
    },
    { failureCode: 'CHAT_FAILED', failureMessage: 'Chat request failed.' },
  )
}

export async function getConversation(jobId: string): Promise<{ messages: ChatMessage[] }> {
  return withTimeout(10_000, async (signal) => {
    const attribution = await getAttributionToken().catch(() => null)
    return queryJson<{ messages: ChatMessage[] }>(capabilityUrl(`/api/conversation/${jobId}`), {
      signal,
      headers: attribution ? { 'x-attribution': attribution } : {},
    })
  })
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export type UserRecord = {
  id: string
  auth0_id: string
  email: string | null
  name: string | null
  nickname: string | null
  picture: string | null
  email_verified: boolean
  role: 'coach' | 'player'
  created_at: string
  updated_at: string
}

export async function syncUser(user: {
  sub: string
  email?: string
  name?: string
  nickname?: string
  picture?: string
  email_verified?: boolean
}): Promise<{ user: UserRecord }> {
  return mutateJson<{ user: UserRecord }>(identityUrl('/api/auth/sync'), 'POST', user)
}

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

export async function getUserProfile(auth0Id: string): Promise<{ user: UserRecord }> {
  return queryJson<{ user: UserRecord }>(authUserUrl(auth0Id))
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

export const getHistoryChatMessages = async (
  auth0Id: string,
  jobId: string,
): Promise<{ messages: ChatMessage[] }> => {
  return queryJson<{ messages: ChatMessage[] }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/chat`),
  )
}

export const sendHistoryChatMessage = async (
  auth0Id: string,
  jobId: string,
  message: string,
): Promise<{ message: string; role: string }> => {
  return mutateJson<{ message: string; role: string }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/chat`),
    'POST',
    { message },
  )
}
