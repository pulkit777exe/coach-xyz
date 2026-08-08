import type { ScanResult, JobStatus, CoachAIError, UploadProgress, ChatMessage } from '@/types'

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

export function scanVideoWithProgress(
  file: File,
  onProgress: (progress: UploadProgress) => void,
  auth0Id?: string | null,
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/scan-video`)

    if (auth0Id) {
      xhr.setRequestHeader('x-auth0-id', auth0Id)
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
    xhr.send(formData)
  })
}

export type ScanProgressEvent = {
  session_token: string
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
): AsyncGenerator<ScanProgressEvent> {
  const res = await fetch(`${BASE}/api/scan-progress/${sessionToken}`, {
    signal,
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
          const event = JSON.parse(line.slice(6)) as ScanProgressEvent
          yield event
        } catch { /* partial JSON, skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
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
        model: 'gemini-2.5-flash',
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
  return `/api/download/${jobId}`
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
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    `${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses?limit=${limit}&offset=${offset}`,
  )
}

export async function getDashboardAnalysisDetail(
  auth0Id: string,
  jobId: string,
): Promise<{ analysis: DashboardAnalysis }> {
  return apiFetch<{ analysis: DashboardAnalysis }>(
    `${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`,
  )
}

export async function getDashboardStats(
  auth0Id: string,
): Promise<{ stats: DashboardStats }> {
  return apiFetch<{ stats: DashboardStats }>(
    `${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/stats`,
  )
}

export const renameAnalysis = async (
  auth0Id: string,
  jobId: string,
  displayName: string,
): Promise<{ analysis: DashboardAnalysis }> => {
  return apiFetch<{ analysis: DashboardAnalysis }>(`${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  })
}

export const getHistoryChatMessages = async (
  auth0Id: string,
  jobId: string,
): Promise<{ messages: ChatMessage[] }> => {
  return apiFetch<{ messages: ChatMessage[] }>(`${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}/chat`)
}

export const sendHistoryChatMessage = async (
  auth0Id: string,
  jobId: string,
  message: string,
): Promise<{ message: string; role: string }> => {
  return apiFetch<{ message: string; role: string }>(`${BASE}/api/auth/user/${encodeURIComponent(auth0Id)}/analyses/${encodeURIComponent(jobId)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
}

// ── Deep Search API ─────────────────────────────────────────────────────────

export type SearchSource = {
  url: string
  title: string
  snippet: string
  relevance: string
}

export type SearchResult = {
  query: string
  report: string
  sources: SearchSource[]
  angles_covered: string[]
  searches_performed: number
  depth_reached: number
  total_time_seconds: number
  metadata: {
    understood_intent?: string
    key_entities?: string[]
    coverage_score?: number
  }
}

export type SearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "decomposition"; intent: string; angles: string[]; entities: string[] }
  | { type: "searching"; current: number; total: number; angle: string }
  | { type: "angle_complete"; angle: string; sources_found: number; current: number; total: number }
  | { type: "gap_filled"; question: string; current: number; total: number }
  | { type: "done"; result: SearchResult }
  | { type: "error"; message: string }

/**
 * Execute a deep research search and stream progress via SSE.
 * Yields SearchStreamEvents as they arrive.
 * Pass an AbortSignal to cancel.
 */
export async function* deepSearchStream(
  query: string,
  maxAngles?: number,
  maxGapSearches?: number,
  signal?: AbortSignal,
): AsyncGenerator<SearchStreamEvent> {
  const body: Record<string, unknown> = { query }
  if (maxAngles) body.max_angles = maxAngles
  if (maxGapSearches) body.max_gap_searches = maxGapSearches

  const res = await fetch(`${BASE}/api/search/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>
    throw {
      code: "SEARCH_FAILED",
      message: (errBody.message as string) ?? "Search request failed.",
      layer: "server",
      retryable: true,
    } as CoachAIError
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        try {
          const event = JSON.parse(line.slice(6)) as SearchStreamEvent
          yield event
        } catch { /* partial JSON, skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Execute a deep research search (non-streaming).
 * Returns the full SearchResult.
 */
export async function deepSearch(
  query: string,
  maxAngles?: number,
  maxGapSearches?: number,
): Promise<SearchResult> {
  const body: Record<string, unknown> = { query }
  if (maxAngles) body.max_angles = maxAngles
  if (maxGapSearches) body.max_gap_searches = maxGapSearches

  return apiFetch<SearchResult>(`${BASE}/api/search`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
