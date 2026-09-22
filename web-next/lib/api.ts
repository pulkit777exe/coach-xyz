import type { ScanResult, JobStatus, CoachAIError, UploadProgress, ChatMessage } from '@/types'
import { parseEventStream } from '@/lib/sse'

const BASE = process.env.NEXT_PUBLIC_API_URL

if (!BASE) {
  console.error('Missing NEXT_PUBLIC_API_URL environment variable. API calls will fail.')
}

// Identity-bearing routes (org + auth/user) always go through the verified
// identity boundary:
//  - server-side (server components): backend directly, with service headers
//    injected in apiFetch
//  - client-side: the same-origin Next proxy (/api/service), which verifies
//    the session and injects those headers
export const IDENTITY_BASE =
  typeof window === 'undefined'
    ? process.env.NEXT_PUBLIC_API_URL
    : '/api/service'

function identityFromRequest(url: string, body?: BodyInit | null): string | undefined {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // relative url — keep as-is
  }

  const scoped = path.match(/\/api\/(?:org|email|auth\/user)\/([^/]+)/)
  if (scoped) return decodeURIComponent(scoped[1])

  if (path.endsWith('/api/auth/sync') && typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { sub?: unknown }
      if (typeof parsed.sub === 'string') return parsed.sub
    } catch {
      // not JSON — the backend will reject it
    }
  }
  return undefined
}

/**
 * Server-side identity for identity-bearing calls. Never trust a path-scoped id
 * here: the backend authorizes the REAL caller, so the header must be the
 * session sub (the actual user), not the org id in the URL. Falls back to the
 * path-derived id only when no session is available (e.g. auth/sync during
 * onboarding, or non-request contexts).
 */
async function serverIdentity(url: string, body?: BodyInit | null): Promise<string | undefined> {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // relative url — keep as-is
  }

  const isIdentityBearing =
    path.match(/\/api\/(?:org|email|auth\/user)\/[^/]+/) !== null ||
    path.startsWith('/api/me/') ||
    path.endsWith('/api/auth/sync')
  if (!isIdentityBearing) return undefined

  try {
    const { getSession } = await import('./session')
    const session = await getSession()
    const sub = session?.user?.sub
    if (sub) return sub
  } catch {
    // Not in a request context (tests, build-time) — fall through.
  }
  return identityFromRequest(url, body)
}

export type { CoachAIError }

// ── API Client ───────────────────────────────────────────────────────────────

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  isFormData = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    // Per-call correlation id, forwarded server→engine for end-to-end traces.
    'x-request-id': crypto.randomUUID(),
    ...(options.headers as Record<string, string> ?? {}),
  }

  // Server-side calls to identity-bearing routes go directly to the backend
  // and carry the service token + the session sub (the REAL caller). The org id
  // in the URL is purely a data-scope — membership is authorized backend-side.
  // Client-side calls reach the backend through the /api/service proxy, which
  // injects the session sub from auth0 itself.
  if (typeof window === 'undefined') {
    const identity = await serverIdentity(url, options.body)
    if (identity) {
      if (process.env.SERVICE_TOKEN) headers['x-service-token'] = process.env.SERVICE_TOKEN
      headers['x-verified-auth0-id'] = identity
    }
  }

  let res: Response
  try {
    res = await fetch(url, { ...options, headers })
  } catch {
    throw {
      code: 'NETWORK_ERROR',
      message: 'Cannot connect to server. Check your connection.',
      layer: 'client',
      retryable: true,
    } as CoachAIError
  }

  if (res.status === 429) {
    const body = await res.json().catch(() => ({}))
    throw {
      code: 'RATE_LIMITED',
      message: body.message ?? 'Too many requests. Please wait.',
      layer: 'server',
      retryable: true,
      retry_after: body.retry_after,
    } as CoachAIError
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {}
    try {
      body = await res.json()
    } catch {
      // Response wasn't JSON
    }

    // If the server returned a structured error, use it
    if (body?.code && body?.message) {
      throw {
        code: body.code,
        message: body.message,
        layer: body.layer ?? 'server',
        retryable: body.retryable ?? true,
      } as CoachAIError
    }

    // Fallback for non-structured errors
    throw {
      code: 'REQUEST_FAILED',
      message: `Request failed (${res.status})`,
      layer: 'server',
      retryable: res.status >= 500,
    } as CoachAIError
  }

  return res.json() as Promise<T>
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch a short-lived attribution token binding the verified session sub.
 * Browser-direct capability routes (scan/analyze/status/chat/conversation)
 * receive it as `x-attribution` so the backend can attribute uploads to the
 * signed-in caller without trusting a raw client header. Cache it until
 * expiry to avoid an extra round-trip per scan/analyze pair.
 */
let attributionTokenCache: { token: string; exp: number } | null = null
export async function getAttributionToken(): Promise<string | null> {
  if (attributionTokenCache && attributionTokenCache.exp > Date.now()) {
    return attributionTokenCache.token
  }
  attributionTokenCache = null
  try {
    const res = await apiFetch<{ token: string; exp: number }>(
      `${IDENTITY_BASE}/api/me/attribution/mint`,
      { method: 'GET' },
    )
    attributionTokenCache = res
    return res.token
  } catch {
    return null
  }
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

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/scan-video`)
    xhr.setRequestHeader('x-request-id', crypto.randomUUID())

    if (token) {
      xhr.setRequestHeader('x-attribution', token)
    }

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100)
        onProgress({ phase: 'uploading', percent })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ScanResult)
        } catch {
          reject({
            code: 'PARSE_ERROR',
            message: 'Invalid response from server.',
            layer: 'server',
            retryable: false,
          } as CoachAIError)
        }
      } else if (xhr.status === 429) {
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
        reject({
          code: 'RATE_LIMITED',
          message: (body.message as string) ?? 'Too many requests. Please wait.',
          layer: 'server',
          retryable: true,
          retry_after: body.retry_after as number | undefined,
        } as CoachAIError)
      } else {
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
        if (body.code && body.message) {
          reject({
            code: body.code as string,
            message: body.message as string,
            layer: (body.layer as string) ?? 'server',
            retryable: (body.retryable as boolean) ?? true,
          } as CoachAIError)
        } else {
          reject({
            code: 'REQUEST_FAILED',
            message: `Request failed (${xhr.status})`,
            layer: 'server',
            retryable: xhr.status >= 500,
          } as CoachAIError)
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject({
        code: 'NETWORK_ERROR',
        message: 'Cannot connect to server. Check your connection.',
        layer: 'client',
        retryable: true,
      } as CoachAIError)
    })

    xhr.addEventListener('abort', () => {
      reject({
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out.',
        layer: 'client',
        retryable: true,
      } as CoachAIError)
    })

    const formData = new FormData()
    formData.append('video', file)
    // Multi-angle flow: append to an existing session under a labeled angle.
    if (opts.sessionToken) formData.append('session_token', opts.sessionToken)
    if (opts.angle) formData.append('angle', opts.angle)
    xhr.send(formData)
  })
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
    ? `${BASE}/api/scan-progress/${sessionToken}?angle=${encodeURIComponent(angle)}`
    : `${BASE}/api/scan-progress/${sessionToken}`
  const res = await fetch(url, {
    signal,
    headers: { 'x-request-id': crypto.randomUUID() },
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
    throw {
      code: 'SCAN_PROGRESS_FAILED',
      message: (errBody.message as string) ?? 'Failed to get scan progress.',
      layer: 'server',
      retryable: true,
    } as CoachAIError
  }

  yield* parseEventStream<ScanProgressEvent>(res)
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
  angle?: string | null
  auth0Id?: string | null
}): Promise<{ job_id: string }> {
  const { auth0Id, ...rest } = params
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000) // 30s for enqueue
  try {
    const attribution = auth0Id ? await getAttributionToken() : null
    return await apiFetch<{ job_id: string }>(`${BASE}/api/analyze-video`, {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        model: 'gemini-2.5-flash',
      }),
      signal: controller.signal,
      headers: attribution ? { 'x-attribution': attribution } : {},
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    // Owned jobs require the caller's signed sub — attach best-effort
    // attribution so status polls keep working after the ownership binding.
    // Anonymous jobs stay readable without it.
    const attribution = await getAttributionToken().catch(() => null)
    return await apiFetch<JobStatus>(`${BASE}/api/job-status/${jobId}`, {
      signal: controller.signal,
      headers: attribution ? { 'x-attribution': attribution } : {},
    })
  } finally {
    clearTimeout(timeout)
  }
}

export function getDownloadUrl(jobId: string): string {
  return `/api/download/${jobId}`
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
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': crypto.randomUUID(),
      ...(attribution ? { 'x-attribution': attribution } : {}),
    },
    body: JSON.stringify({ job_id: jobId, message }),
    signal,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
    throw {
      code: 'CHAT_FAILED',
      message: (errBody.message as string) ?? 'Chat request failed.',
      layer: 'server',
      retryable: true,
    } as CoachAIError
  }

  yield* parseEventStream<StreamEvent>(res)
}

export async function getConversation(
  jobId: string,
): Promise<{ messages: ChatMessage[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const attribution = await getAttributionToken().catch(() => null)
    return await apiFetch<{ messages: ChatMessage[] }>(
      `${BASE}/api/conversation/${jobId}`,
      {
        signal: controller.signal,
        headers: attribution ? { 'x-attribution': attribution } : {},
      },
    )
  } finally {
    clearTimeout(timeout)
  }
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
  return apiFetch<{ user: UserRecord }>(`${IDENTITY_BASE}/api/auth/sync`, {
    method: 'POST',
    body: JSON.stringify(user),
  })
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
  if (opts.unlinked) params.set("unlinked", "1")
  return apiFetch<{ analyses: DashboardAnalysis[] }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses?${params.toString()}`,
  )
}

export async function getDashboardAnalysisDetail(
  auth0Id: string,
  jobId: string,
): Promise<{ analysis: DashboardAnalysis }> {
  return apiFetch<{ analysis: DashboardAnalysis }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`,
  )
}

export async function getDashboardStats(
  auth0Id: string,
): Promise<{ stats: DashboardStats }> {
  return apiFetch<{ stats: DashboardStats }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/stats`,
  )
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
  return apiFetch<{ trends: FindingsTrendPoint[] }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/findings/trends${qs ? `?${qs}` : ''}`,
  )
}

export async function reviewFinding(
  auth0Id: string,
  findingId: string,
  reviewState: 'approved' | 'flagged',
): Promise<{ id: string; review_state: string }> {
  return apiFetch<{ id: string; review_state: string }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/findings/${encodeURIComponent(findingId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ review_state: reviewState }),
    },
  )
}

export async function getUserProfile(
  auth0Id: string,
): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(
    `${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}`,
  )
}

export const cancelAnalysis = async (
  auth0Id: string,
  jobId: string,
): Promise<{ cancelled: boolean }> => {
  return apiFetch<{ cancelled: boolean }>(`${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  })
}

export const deleteAnalysis = async (
  auth0Id: string,
  jobId: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(`${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  })
}

export const renameAnalysis = async (  auth0Id: string,
  jobId: string,
  displayName: string,
): Promise<{ analysis: DashboardAnalysis }> => {
  return apiFetch<{ analysis: DashboardAnalysis }>(`${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  })
}

export const getHistoryChatMessages = async (
  auth0Id: string,
  jobId: string,
): Promise<{ messages: ChatMessage[] }> => {
  return apiFetch<{ messages: ChatMessage[] }>(`${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}/chat`)
}

export const sendHistoryChatMessage = async (
  auth0Id: string,
  jobId: string,
  message: string,
): Promise<{ message: string; role: string }> => {
  return apiFetch<{ message: string; role: string }>(`${IDENTITY_BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
}
