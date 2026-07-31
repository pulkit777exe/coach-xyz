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

export async function scanVideo(file: File): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('video', file)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000) // 2 min for uploads
  try {
    return await apiFetch<ScanResult>(`${BASE}/api/scan-video`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }, true)
  } finally {
    clearTimeout(timeout)
  }
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
}): Promise<{ job_id: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000) // 30s for enqueue
  try {
    return await apiFetch<{ job_id: string }>(`${BASE}/api/analyze-video`, {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        model: 'gemini-3.5-flash',
      }),
      signal: controller.signal,
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

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}

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
