import type { UploadProgress } from '@/types'

import { parseEventStream } from '../sse'
import {
  mapFetchRejection,
  mapResponseError,
  networkError,
  parseError,
  parseXhrJson,
  rateLimitedError,
  storageNetworkError,
  streamFailureError,
  timeoutError,
  uploadFailedError,
} from './errors'
import { defaultTransport, serviceHeaders, type Transport } from './transport'

// ── Data client ──────────────────────────────────────────────────────────────
// Generic query/mutate/stream/upload primitives over an injected transport,
// in the TanStack Query spirit: declarative reads (`queryJson`) vs writes
// (`mutateJson`), one error taxonomy (./errors), one timeout helper, one XHR
// upload path. Facades in lib/*.ts stay caller-shaped (their signatures never
// change) and delegate here; tests inject a fake `Transport` instead of the
// network.

export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  isFormData = false,
  transport?: Transport,
): Promise<T> {
  const t = transport ?? defaultTransport()
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    // Per-call correlation id, forwarded server→engine for end-to-end traces.
    'x-request-id': t.randomId(),
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  }

  // Server-side calls to identity-bearing routes go directly to the backend
  // and carry the service token + the session sub (the REAL caller). The org id
  // in the URL is purely a data-scope — membership is authorized backend-side.
  // Client-side calls reach the backend through the /api/service proxy, which
  // injects the session sub from auth0 itself.
  if (typeof window === 'undefined') {
    const svc = await serviceHeaders(url, options.body as BodyInit | null | undefined)
    Object.assign(headers, svc)
  }

  let res: Response
  try {
    res = await t.fetchFn(url, { ...options, headers })
  } catch (err) {
    throw mapFetchRejection(err)
  }

  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw rateLimitedError(body)
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      // Response wasn't JSON
    }
    throw mapResponseError(res.status, body)
  }

  try {
    return (await res.json()) as T
  } catch {
    throw parseError()
  }
}

/** Declarative read — GETs and other bodyless fetches. */
export async function queryJson<T>(
  url: string,
  init: RequestInit = {},
  transport?: Transport,
): Promise<T> {
  return requestJson<T>(url, init, false, transport)
}

/** Declarative write — POST/PUT/PATCH/DELETE with a JSON payload. */
export async function mutateJson<T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  init: RequestInit = {},
  transport?: Transport,
): Promise<T> {
  return requestJson<T>(
    url,
    { ...init, method, body: body === undefined ? undefined : JSON.stringify(body) },
    false,
    transport,
  )
}

/**
 * Single-sourced abort/timeout wrapper. Replaces the per-callsite
 * `new AbortController()` + `setTimeout(abort)` + `clearTimeout` triplication
 * (analyze 30s, job-status 15s, conversation 10s, player analyze 30s).
 */
export async function withTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Single-sourced `{ job_id }` enqueue: timeout + JSON POST in one place, so the
 * coach flow and the player flow share the abort behavior and response shape.
 */
export async function postJob(
  url: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; headers?: Record<string, string>; transport?: Transport } = {},
): Promise<{ job_id: string }> {
  return withTimeout(opts.timeoutMs ?? 30_000, (signal) =>
    requestJson<{ job_id: string }>(
      url,
      { method: 'POST', body: JSON.stringify(payload), headers: opts.headers, signal },
      false,
      opts.transport,
    ),
  )
}

export type StreamFailureCode = 'SCAN_PROGRESS_FAILED' | 'CHAT_FAILED'

/**
 * Single SSE GET/POST over the injected transport. Non-2xx responses map
 * through the shared taxonomy (scan-progress vs chat failure codes); aborts
 * map to REQUEST_TIMEOUT via `mapFetchRejection`, matching `toCoachAIError`.
 */
export async function* streamJson<T>(
  url: string,
  init: RequestInit = {},
  opts: {
    transport?: Transport
    failureCode?: StreamFailureCode
    failureMessage?: string
  } = {},
): AsyncGenerator<T> {
  const t = opts.transport ?? defaultTransport()
  const failureCode = opts.failureCode ?? 'SCAN_PROGRESS_FAILED'
  const failureMessage = opts.failureMessage ?? 'Stream request failed.'

  let res: Response
  try {
    res = await t.fetchFn(url, {
      ...init,
      headers: {
        'x-request-id': t.randomId(),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    })
  } catch (err) {
    throw mapFetchRejection(err)
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw streamFailureError(failureCode, failureMessage, errBody)
  }

  yield* parseEventStream<T>(res)
}

export type XhrUploadOptions = {
  url: string
  file: File
  fieldName?: string
  formFields?: Record<string, string>
  headers?: Record<string, string>
  onProgress?: (progress: UploadProgress) => void
  transport?: Transport
}

/**
 * The one XHR multipart upload (scan-video path): progress events, then the
 * shared `parseXhrJson` mapping so XHR load/error/abort classify exactly like
 * their fetch counterparts (network/429/parse/abort parity).
 */
export function uploadXhr<T>(opts: XhrUploadOptions): Promise<T> {
  const {
    url,
    file,
    fieldName = 'video',
    formFields = {},
    headers = {},
    onProgress,
    transport,
  } = opts
  const t = transport ?? defaultTransport()
  return new Promise<T>((resolve, reject) => {
    const xhr = t.xhrFactory()
    xhr.open('POST', url)
    xhr.setRequestHeader('x-request-id', t.randomId())
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress?.({ phase: 'uploading', percent: Math.round((e.loaded / e.total) * 100) })
      }
    })

    xhr.addEventListener('load', () => {
      const parsed = parseXhrJson<T>(xhr.status, xhr.responseText)
      if (parsed.ok) resolve(parsed.value)
      else reject(parsed.error)
    })

    xhr.addEventListener('error', () => {
      reject(networkError())
    })

    xhr.addEventListener('abort', () => {
      reject(timeoutError())
    })

    const formData = new FormData()
    formData.append(fieldName, file)
    for (const [key, value] of Object.entries(formFields)) formData.append(key, value)
    xhr.send(formData)
  })
}

/** XHR POST of a file to a presigned S3 URL with upload progress. */
export function postPresigned(
  file: File,
  url: string,
  fields: Record<string, string>,
  onProgress: (progress: UploadProgress) => void,
  transport?: Transport,
): Promise<void> {
  const t = transport ?? defaultTransport()
  return new Promise<void>((resolve, reject) => {
    const xhr = t.xhrFactory()
    xhr.open('POST', url)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress({ phase: 'uploading', percent: Math.round((e.loaded / e.total) * 100) })
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(uploadFailedError())
    })
    xhr.addEventListener('error', () => {
      reject(storageNetworkError())
    })
    xhr.addEventListener('abort', () => {
      reject(timeoutError())
    })
    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) formData.append(key, value)
    formData.append('file', file)
    xhr.send(formData)
  })
}

/** Drop `undefined` and empty-string fields before POST/PUT (server re-validates). */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== '') out[key as keyof T] = value as T[keyof T]
  }
  return out
}
