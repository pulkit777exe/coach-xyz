import type { ScanResult, JobStatus, CoachAIError } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

if (!BASE) {
  console.error('Missing NEXT_PUBLIC_API_URL environment variable. API calls will fail.')
}

export type { CoachAIError }

// ── API Client ───────────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  isFormData = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> ?? {}),
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
    let body: any = {}
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

export async function scanVideo(file: File, auth0Id?: string | null): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('video', file)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000) // 3 min for uploads
  try {
    return await apiFetch<ScanResult>(`${BASE}/api/scan-video`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: auth0Id ? { 'x-auth0-id': auth0Id } : {},
    }, true)
  } finally {
    clearTimeout(timeout)
  }
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
  auth0Id?: string | null
}): Promise<{ job_id: string }> {
  const { auth0Id, ...rest } = params
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000) // 30s for enqueue
  try {
    return await apiFetch<{ job_id: string }>(`${BASE}/api/analyze-video`, {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        model: 'gemini-3.5-flash',
      }),
      signal: controller.signal,
      headers: auth0Id ? { 'x-auth0-id': auth0Id } : {},
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await apiFetch<JobStatus>(`${BASE}/api/job-status/${jobId}`, {
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export function getDownloadUrl(jobId: string): string {
  return `${BASE}/api/download/${jobId}`
}

// ── Chat API ─────────────────────────────────────────────────────────────────

export type { ChatMessage } from '@/types'
import type { ChatMessage } from '@/types'

export type ChatResponse = {
  reply: string
  timestamp_refs: number[]
  event_refs: number[]
}

export async function sendChatMessage(
  jobId: string,
  message: string,
): Promise<ChatResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    return await apiFetch<ChatResponse>(`${BASE}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, message }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

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
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, message }),
    signal,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((errBody.message as string) ?? 'Chat request failed')
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as StreamEvent
          yield event
        } catch { /* partial JSON, skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function getConversation(
  jobId: string,
): Promise<{ messages: ChatMessage[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await apiFetch<{ messages: ChatMessage[] }>(
      `${BASE}/api/conversation/${jobId}`,
      { signal: controller.signal },
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
  return apiFetch<{ user: UserRecord }>(`${BASE}/api/auth/sync`, {
    method: 'POST',
    body: JSON.stringify(user),
  })
}

export async function getUser(auth0Id: string): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(`${BASE}/api/auth/user/${auth0Id}`)
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
  summary_json: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
  requested_at: string
  completed_at: string | null
  download_count: number
  file_name: string | null
  file_size_bytes: number | null
  player_count: number | null
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
): Promise<{ analyses: DashboardAnalysis[] }> {
  return apiFetch<{ analyses: DashboardAnalysis[] }>(
    `${BASE}/api/auth/user/${auth0Id}/analyses?limit=${limit}&offset=${offset}`,
  )
}

export async function getDashboardAnalysisDetail(
  auth0Id: string,
  jobId: string,
): Promise<{ analysis: DashboardAnalysis }> {
  return apiFetch<{ analysis: DashboardAnalysis }>(
    `${BASE}/api/auth/user/${auth0Id}/analyses/${jobId}`,
  )
}

export async function getDashboardStats(
  auth0Id: string,
): Promise<{ stats: DashboardStats }> {
  return apiFetch<{ stats: DashboardStats }>(
    `${BASE}/api/auth/user/${auth0Id}/stats`,
  )
}
