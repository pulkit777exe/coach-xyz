import type { ScanResult, JobStatus } from '@/types'
import { clearBetaCode, getBetaCode } from './betaCode'

const BASE = process.env.NEXT_PUBLIC_API_URL

// ── Error Type ───────────────────────────────────────────────────────────────
// All errors from the API follow this shape.

export interface CoachAIError {
  code: string
  message: string
  layer: 'engine' | 'server' | 'client'
  retryable: boolean
  retry_after?: number
}

// ── API Client ───────────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  isFormData = false,
): Promise<T> {
  const code = getBetaCode()
  const headers: Record<string, string> = {
    ...(code ? { 'x-beta-code': code } : {}),
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

  if (res.status === 401) {
    clearBetaCode()
    throw {
      code: 'INVALID_BETA_CODE',
      message: 'Beta access expired. Please re-enter your code.',
      layer: 'server',
      retryable: false,
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

  return apiFetch<ScanResult>(`${BASE}/api/scan-video`, {
    method: 'POST',
    body: formData,
  }, true)
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
}): Promise<{ job_id: string }> {
  return apiFetch<{ job_id: string }>(`${BASE}/api/analyze-video`, {
    method: 'POST',
    body: JSON.stringify({
      ...params,
      model: 'gemini-2.5-flash',
    }),
  })
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`${BASE}/api/job-status/${jobId}`)
}

export function getDownloadUrl(jobId: string): string {
  return `${BASE}/api/download/${jobId}`
}
