import type { ScanResult, JobStatus, UploadProgress } from '@/types'

import { getAttributionToken } from './data/attribution'
import {
  mutateJson,
  postJob,
  postPresigned,
  queryJson,
  streamJson,
  uploadXhr,
  withTimeout,
} from './data/client'
import { capabilityBase, capabilityUrl, downloadPath } from './data/transport'

if (!capabilityBase()) {
  console.error('Missing NEXT_PUBLIC_API_URL environment variable. API calls will fail.')
}

// ── Scan + analysis client ─────────────────────────────────────────────────
// Entity facade over the data core for the scan → analyze → poll → download
// flow (both coach and player surfaces drive it through usePipeline).

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
      model: 'gemini-3.8-flash',
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
