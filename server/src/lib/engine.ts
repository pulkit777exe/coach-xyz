import { engineFailure, wrapEngineError } from './errors'
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

/** Connectivity mapping: the engine never answered, so this error is
 * deliberately STATUSLESS — routes distinguish "engine said no" (stamped by
 * throwNonOk) from "engine never answered" via the missing status. */
const unavailableEngineError = (): CoachAIError => wrapEngineError({ code: 'ENGINE_UNAVAILABLE' })

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

/**
 * The keystone of pass-through status: parse the engine's error body AND
 * stamp the HTTP status it answered with onto the thrown CoachAIError, so no
 * route ever re-derives a status from the code. `defaults` fill a body the
 * engine didn't send (e.g. a proxy-level failure) for endpoint-specific
 * fallbacks. Wire `retryable` is the engine's flag; absent body → true
 * (assume transient, the historical posture).
 */
const throwNonOk = async (
  res: Response,
  defaults: { code?: string; message?: string } = {},
): Promise<never> => {
  const body = (await res.json().catch(() => ({}))) as Partial<CoachAIError>
  throw engineFailure(
    {
      code: body.code ?? defaults.code ?? 'UNKNOWN',
      message: body.message ?? defaults.message ?? 'Something went wrong.',
      retryable: body.retryable ?? true,
    },
    res.status,
  )
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

  try {
    const res = await withTimeout(
      `${ENGINE_URL}/scan`,
      {
        method: 'POST',
        headers: engineServiceHeaders(requestId),
        body: form,
      },
      180_000,
    )

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as ScanResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }

    throw error
  }
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
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/upload-intent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...engineServiceHeaders(requestId) },
        body: JSON.stringify(payload),
      },
      15_000,
    )

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as UploadIntent
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }

    throw error
  }
}

export const scanFromKey = async (
  payload: { storage_key: string; session_token?: string | null; angle?: string | null },
  requestId?: string | null,
): Promise<ScanResult> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/scan-from-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...engineServiceHeaders(requestId) },
        body: JSON.stringify(payload),
      },
      180_000,
    )

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as ScanResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }

    throw error
  }
}

export const getDownloadStream = async (
  engineJobId: string,
  requestId?: string | null,
): Promise<Response> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/download/${engineJobId}`,
      {
        method: 'GET',
        headers: engineServiceHeaders(requestId),
      },
      60_000,
    )

    if (!res.ok) {
      // Pass the engine's body through (jobs.py /download answers
      // JOB_NOT_FOUND / VIDEO_NOT_FOUND / VIDEO_EXPIRED with the canonical
      // text) and stamp the status; the defaults only cover a body-less
      // failure, where /download's historical answer was JOB_NOT_FOUND.
      await throwNonOk(res, {
        code: 'JOB_NOT_FOUND',
        message: 'Job not found or expired.',
      })
    }

    return res
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }

    throw error
  }
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
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/analyze`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(requestId),
        },
        body: JSON.stringify(payload),
      },
      12 * 60 * 1000,
    ) // 12 min max — longest single analysis span

    if (!res.ok) {
      await throwNonOk(res)
    }
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }

    throw error
  }
}

export type EngineStatusResult =
  | { status: 'found'; data: EngineJobStatus }
  | { status: 'not_found' }
  | { status: 'transient_error' }

export const getEngineJobStatus = async (
  engineJobId: string,
  requestId?: string | null,
): Promise<EngineStatusResult> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/status/${engineJobId}`,
      {
        method: 'GET',
        headers: engineServiceHeaders(requestId),
      },
      15_000,
    ) // 15s — free-tier Render instances can take 10–30s to respond after spin-up

    if (!res.ok) {
      if (res.status === 404) return { status: 'not_found' }
      await throwNonOk(res)
    }

    return { status: 'found', data: (await res.json()) as EngineJobStatus }
  } catch (error) {
    if (isConnectivityError(error)) {
      return { status: 'transient_error' }
    }
    throw error
  }
}

export const markEngineJobFailed = async (
  engineJobId: string,
  message: string,
  code: string,
  retryable: boolean,
  requestId?: string | null,
): Promise<void> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/fail/${engineJobId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(requestId),
        },
        body: JSON.stringify({ message, code, retryable }),
      },
      10_000,
    )

    if (!res.ok && res.status !== 404) {
      await throwNonOk(res)
    }
  } catch (error) {
    if (isConnectivityError(error)) {
      return
    }
    throw error
  }
}

export const getScanProgressStream = async (
  sessionToken: string,
  angle?: string | null,
  requestId?: string | null,
): Promise<Response> => {
  try {
    const url = angle
      ? `${ENGINE_URL}/scan-progress/${sessionToken}?angle=${encodeURIComponent(angle)}`
      : `${ENGINE_URL}/scan-progress/${sessionToken}`
    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        ...engineServiceHeaders(requestId),
      },
    })

    if (!res.ok) {
      await throwNonOk(res)
    }

    return res
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }
    throw error
  }
}

// ── Chat ────────────────────────────────────────────────────────────────────

export type EngineChatTurn = { role: string; content: string }

export type EngineChatPayload = {
  job_id: string
  message: string
  conversation_history: EngineChatTurn[]
}

export type EngineChatReply = {
  reply: string
  message?: string
  timestamp_refs?: number[]
  event_refs?: number[]
}

/**
 * One non-streaming chat round-trip against the engine's /chat — same seam as
 * every other engine call: timeout wrapper, connectivity classification, and
 * CoachAIError-shaped failures through throwNonOk.
 *
 * Error-path discriminator: an engine ERROR RESPONSE (429/503/500 with a
 * body) throws a CoachAIError carrying the HTTP `status`, so callers can
 * surface it via the shared chat posture (errors.chatEngineStatus: 4xx pass
 * through, ≥500 → 502). A connectivity failure or timeout throws a STATUSLESS
 * ENGINE_UNAVAILABLE, so "the engine never answered" never reads as "the
 * engine answered no".
 */
export const askEngineChat = async (
  payload: EngineChatPayload,
  requestId?: string | null,
): Promise<EngineChatReply> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(requestId),
        },
        body: JSON.stringify(payload),
      },
      30_000, // dashboard-chat deadline (unchanged from the hand-rolled call)
    )

    if (!res.ok) {
      await throwNonOk(res, { code: 'CHAT_FAILED', message: 'AI service error.' })
    }

    return (await res.json()) as EngineChatReply
  } catch (error) {
    if (isConnectivityError(error)) {
      throw unavailableEngineError()
    }
    throw error
  }
}
