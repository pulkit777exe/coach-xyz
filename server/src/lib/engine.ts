import type { CoachAIError, JobStatus, ScanResult } from '../types'

export const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8001'

/**
 * Raw engine status payload. Same wire shape as JobStatus (the response type)
 * plus created_at, which Batch 3 of the engine job payload carries.
 */
export type EngineJobStatus = JobStatus & { created_at: string | null }

/** Shared-secret header the engine enforces when SERVICE_TOKEN is set. */
export const engineServiceHeaders = (requestId?: string | null): Record<string, string> => ({
  ...(process.env.SERVICE_TOKEN ? { 'x-service-token': process.env.SERVICE_TOKEN } : {}),
  ...(requestId ? { 'x-request-id': requestId } : {}),
})

/** Correlation id for one client request: forwarded when the web sent one,
 * generated otherwise so every engine call is traceable end to end. */
export const requestIdFrom = (request: Request): string =>
  request.headers.get('x-request-id')?.trim() || crypto.randomUUID()

function engineError(code: string, message: string, retryable = true): CoachAIError {
  return { code, message, layer: 'engine', retryable }
}

export const withTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

const throwNonOk = async (res: Response): Promise<never> => {
  const body = (await res.json().catch(() => ({}))) as Partial<CoachAIError>
  throw engineError(
    body.code ?? 'UNKNOWN',
    body.message ?? 'Something went wrong.',
    body.retryable ?? true,
  )
}

export type EngineRequestOpts<T> = {
  method?: string
  /** Plain objects serialize as JSON (plus content-type); FormData passes through. */
  body?: Record<string, unknown> | FormData | string | null
  requestId?: string | null
  /** Omitted for held-open streams (scan-progress): plain fetch, no abort. */
  timeoutMs?: number
  accept?: string
  /** Non-ok mapping (default: structured errors pass through). */
  mapNotOk?: (res: Response) => Promise<T>
  /** Connectivity mapping (default: throw ENGINE_UNAVAILABLE). */
  mapConnectivity?: () => T
  /** Success mapping (default: parse JSON). */
  parse?: (res: Response) => Promise<T>
}

/**
 * Single transport for every engine call: service headers + optional
 * attribution id, timeout, non-ok mapping, connectivity mapping, parse.
 * Endpoint wrappers keep only their path/method/body/timeout and any
 * non-default mapping.
 */
export const engineRequest = async <T>(path: string, opts: EngineRequestOpts<T>): Promise<T> => {
  const headers: Record<string, string> = { ...engineServiceHeaders(opts.requestId) }
  let body: FormData | string | undefined
  if (opts.body !== undefined && opts.body !== null) {
    if (opts.body instanceof FormData) {
      body = opts.body
    } else if (typeof opts.body === 'object') {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    } else {
      body = opts.body
    }
  }
  if (opts.accept) headers['Accept'] = opts.accept

  try {
    const init: RequestInit = { method: opts.method ?? 'GET', headers, body }
    const res =
      opts.timeoutMs === undefined
        ? await fetch(`${ENGINE_URL}${path}`, init)
        : await withTimeout(`${ENGINE_URL}${path}`, init, opts.timeoutMs)

    if (!res.ok) {
      return await (opts.mapNotOk ?? throwNonOk)(res)
    }

    return await (opts.parse ?? ((r: Response) => r.json() as Promise<T>))(res)
  } catch (error) {
    if (isConnectivityError(error)) {
      if (opts.mapConnectivity) return opts.mapConnectivity()
      throw engineError('ENGINE_UNAVAILABLE', 'Analysis engine is temporarily unavailable.')
    }

    throw error
  }
}

export const isConnectivityError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error &&
    /ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND|fetch failed/i.test(
      `${error.message} ${error.cause ?? ''}`,
    )) ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    /^(ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND|UND_ERR)$/i.test(
      String((error as Record<string, unknown>).code),
    ))

export const scanVideo = async (
  videoFile: File,
  opts: { sessionToken?: string | null; angle?: string | null } = {},
  requestId?: string | null,
): Promise<ScanResult> => {
  const form = new FormData()
  form.append('video', videoFile, videoFile.name || 'video.mp4')
  // Multi-angle flow: appending to an existing session reuses its token and
  // labels the new perspective. The engine defaults both when omitted.
  if (opts.sessionToken) form.append('session_token', opts.sessionToken)
  if (opts.angle) form.append('angle', opts.angle)

  return engineRequest<ScanResult>('/scan', {
    method: 'POST',
    body: form,
    requestId,
    timeoutMs: 180_000,
  })
}

export type UploadIntent = {
  key: string
  session_token: string
  angle: string
  upload:
    | { mode: 'multipart'; scan_url: string }
    | { mode: 'presigned'; url: string; fields: Record<string, string> }
}

export const requestUploadIntent = async (
  payload: {
    filename: string
    mime_type: string
    size_bytes: number
    session_token?: string | null
    angle?: string | null
  },
  requestId?: string | null,
): Promise<UploadIntent> => {
  return engineRequest<UploadIntent>('/upload-intent', {
    method: 'POST',
    body: payload,
    requestId,
    timeoutMs: 15_000,
  })
}

export const scanFromKey = async (
  payload: { storage_key: string; session_token?: string | null; angle?: string | null },
  requestId?: string | null,
): Promise<ScanResult> => {
  return engineRequest<ScanResult>('/scan-from-key', {
    method: 'POST',
    body: payload,
    requestId,
    timeoutMs: 180_000,
  })
}

export const getDownloadStream = async (
  engineJobId: string,
  requestId?: string | null,
): Promise<Response> => {
  return engineRequest<Response>(`/download/${engineJobId}`, {
    method: 'GET',
    requestId,
    timeoutMs: 60_000,
    mapNotOk: async () => {
      throw engineError('JOB_NOT_FOUND', 'Job not found or expired.')
    },
    parse: async (res) => res,
  })
}

export type AnalyzePayload = {
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  video_key: string | null
  angle?: string | null
}

export const analyzeVideo = async (
  payload: AnalyzePayload,
  requestId?: string | null,
): Promise<void> => {
  await engineRequest<void>('/analyze', {
    method: 'POST',
    body: payload,
    requestId,
    timeoutMs: 12 * 60 * 1000, // 12 min max — longest single analysis span
    parse: async () => undefined,
  })
}

export type EngineStatusResult =
  | { status: 'found'; data: EngineJobStatus }
  | { status: 'not_found' }
  | { status: 'transient_error' }

export const getEngineJobStatus = async (
  engineJobId: string,
  requestId?: string | null,
): Promise<EngineStatusResult> => {
  return engineRequest<EngineStatusResult>(`/status/${engineJobId}`, {
    method: 'GET',
    requestId,
    timeoutMs: 15_000, // 15s — free-tier Render instances can take 10–30s to respond after spin-up
    mapNotOk: async (res): Promise<EngineStatusResult> => {
      if (res.status === 404) return { status: 'not_found' } as const
      return throwNonOk(res)
    },
    mapConnectivity: () => ({ status: 'transient_error' }) as const,
    parse: async (res) =>
      ({ status: 'found', data: (await res.json()) as EngineJobStatus }) as const,
  })
}

export const markEngineJobFailed = async (
  engineJobId: string,
  message: string,
  code: string,
  retryable: boolean,
  requestId?: string | null,
): Promise<void> => {
  await engineRequest<void>(`/fail/${engineJobId}`, {
    method: 'POST',
    body: { message, code, retryable },
    requestId,
    timeoutMs: 10_000,
    mapNotOk: async (res) => {
      if (res.status === 404) return undefined
      await throwNonOk(res)
    },
    mapConnectivity: () => undefined,
    parse: async () => undefined,
  })
}

export type ScanProgressEvent = {
  session_token: string
  current: number
  total: number
  complete: boolean
  error: string | null
}

export const getScanProgressStream = async (
  sessionToken: string,
  angle?: string | null,
  requestId?: string | null,
): Promise<Response> => {
  const path = angle
    ? `/scan-progress/${sessionToken}?angle=${encodeURIComponent(angle)}`
    : `/scan-progress/${sessionToken}`
  // Held-open SSE stream: no timeout (an abort would cut the stream mid-flow).
  return engineRequest<Response>(path, {
    method: 'GET',
    requestId,
    accept: 'text/event-stream',
    parse: async (res) => res,
  })
}
