import type { CoachAIError } from '@/types'

// ── Data error taxonomy ──────────────────────────────────────────────────────
// Centralized, closed error union for every transport in the data core
// (fetch JSON, XHR upload, SSE streams). Each variant carries a literal `code`
// discriminant with its fixed `layer`/`retryable` pairing, so callers can
// narrow on `code` the same way they narrow `UploadIntent` on `upload.mode`
// or `StreamEvent` on `type`.
//
// Every variant is assignable to the canonical `CoachAIError` shape, so values
// pass through `toCoachAIError` (lib/errors.ts) unchanged and `isTransientError`
// classifies them by the same `retryable` flag. The one open variant is
// `ServerPassthroughError`, which preserves arbitrary server-emitted codes
// (e.g. `INVALID_REQUEST`) instead of collapsing them to `REQUEST_FAILED`.

export type NetworkError = {
  code: 'NETWORK_ERROR'
  message: string
  layer: 'client'
  retryable: true
}

export type RateLimitedError = {
  code: 'RATE_LIMITED'
  message: string
  layer: 'server'
  retryable: true
  retry_after?: number
}

export type ParseError = {
  code: 'PARSE_ERROR'
  message: string
  layer: 'server'
  retryable: false
}

export type TimeoutError = {
  code: 'REQUEST_TIMEOUT'
  message: string
  layer: 'client'
  retryable: true
}

export type UploadFailedError = {
  code: 'UPLOAD_FAILED'
  message: string
  layer: 'server'
  retryable: true
}

export type ScanProgressFailedError = {
  code: 'SCAN_PROGRESS_FAILED'
  message: string
  layer: 'server'
  retryable: true
}

export type ChatFailedError = {
  code: 'CHAT_FAILED'
  message: string
  layer: 'server'
  retryable: true
}

export type RequestFailedError = {
  code: 'REQUEST_FAILED'
  message: string
  layer: 'server'
  retryable: boolean
}

export type UnknownDataError = {
  code: 'UNKNOWN'
  message: string
  layer: 'client'
  retryable: false
}

/** Structured server error with an arbitrary code — preserved, not collapsed. */
export type ServerPassthroughError = {
  code: string
  message: string
  layer: 'engine' | 'server' | 'client'
  retryable: boolean
  retry_after?: number
}

export type DataError =
  | NetworkError
  | RateLimitedError
  | ParseError
  | TimeoutError
  | UploadFailedError
  | ScanProgressFailedError
  | ChatFailedError
  | RequestFailedError
  | UnknownDataError
  | ServerPassthroughError

export type KnownDataErrorCode =
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'PARSE_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'UPLOAD_FAILED'
  | 'SCAN_PROGRESS_FAILED'
  | 'CHAT_FAILED'
  | 'REQUEST_FAILED'
  | 'UNKNOWN'

type StructuredBody = {
  code: string
  message: string
  layer?: unknown
  retryable?: unknown
  retry_after?: unknown
}

export function networkError(
  message = 'Cannot connect to server. Check your connection.',
): NetworkError {
  return { code: 'NETWORK_ERROR', message, layer: 'client', retryable: true }
}

export function storageNetworkError(): NetworkError {
  return networkError('Cannot connect to storage. Check your connection.')
}

export function rateLimitedError(body?: Record<string, unknown>): RateLimitedError {
  const message = (body?.message as string | undefined) ?? 'Too many requests. Please wait.'
  return {
    code: 'RATE_LIMITED',
    message,
    layer: 'server',
    retryable: true,
    retry_after: body?.retry_after as number | undefined,
  }
}

export function parseError(): ParseError {
  return {
    code: 'PARSE_ERROR',
    message: 'Invalid response from server.',
    layer: 'server',
    retryable: false,
  }
}

export function timeoutError(): TimeoutError {
  return {
    code: 'REQUEST_TIMEOUT',
    message: 'Request timed out.',
    layer: 'client',
    retryable: true,
  }
}

export function uploadFailedError(): UploadFailedError {
  return {
    code: 'UPLOAD_FAILED',
    message: 'Direct upload failed. Please try again.',
    layer: 'server',
    retryable: true,
  }
}

export function requestFailedError(status: number): RequestFailedError {
  return {
    code: 'REQUEST_FAILED',
    message: `Request failed (${status})`,
    layer: 'server',
    retryable: status >= 500,
  }
}

function normalizeLayer(layer: unknown): 'engine' | 'server' | 'client' {
  return layer === 'engine' || layer === 'client' || layer === 'server' ? layer : 'server'
}

export function passthroughError(body: StructuredBody): ServerPassthroughError {
  return {
    code: body.code,
    message: body.message,
    layer: normalizeLayer(body.layer),
    retryable: typeof body.retryable === 'boolean' ? body.retryable : true,
    retry_after: body.retry_after as number | undefined,
  }
}

export function streamFailureError(
  code: 'SCAN_PROGRESS_FAILED',
  defaultMessage: string,
  body: Record<string, unknown>,
): ScanProgressFailedError
export function streamFailureError(
  code: 'CHAT_FAILED',
  defaultMessage: string,
  body: Record<string, unknown>,
): ChatFailedError
export function streamFailureError(
  code: 'SCAN_PROGRESS_FAILED' | 'CHAT_FAILED',
  defaultMessage: string,
  body: Record<string, unknown>,
): ScanProgressFailedError | ChatFailedError
export function streamFailureError(
  code: 'SCAN_PROGRESS_FAILED' | 'CHAT_FAILED',
  defaultMessage: string,
  body: Record<string, unknown>,
): ScanProgressFailedError | ChatFailedError {
  const message = (body?.message as string | undefined) ?? defaultMessage
  return { code, message, layer: 'server', retryable: true } as
    | ScanProgressFailedError
    | ChatFailedError
}

export function unknownError(err: unknown): UnknownDataError {
  return { code: 'UNKNOWN', message: String(err), layer: 'client', retryable: false }
}

/** Parse a response body that must be a JSON object — never throws. */
export function safeParseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Single mapping for every non-2xx fetch/XHR response: 429 → RATE_LIMITED,
 * structured `{code, message}` → passthrough, anything else → REQUEST_FAILED.
 */
export function mapResponseError(status: number, body: Record<string, unknown>): DataError {
  if (status === 429) return rateLimitedError(body)
  if (typeof body?.code === 'string' && typeof body?.message === 'string') {
    return passthroughError(body as StructuredBody)
  }
  return requestFailedError(status)
}

/**
 * Single mapping for XHR `load` events (scan upload path): 2xx parses the
 * JSON payload (PARSE_ERROR on malformed bodies), non-2xx delegates to
 * `mapResponseError` so XHR and fetch classify identically.
 */
export function parseXhrJson<T>(
  status: number,
  responseText: string,
): { ok: true; value: T } | { ok: false; error: DataError } {
  if (status >= 200 && status < 300) {
    try {
      return { ok: true, value: JSON.parse(responseText) as T }
    } catch {
      return { ok: false, error: parseError() }
    }
  }
  return { ok: false, error: mapResponseError(status, safeParseJson(responseText)) }
}

/**
 * Single mapping for fetch rejections. Abortions (timeout cancellations,
 * unmount teardowns) become REQUEST_TIMEOUT — the same code the XHR `abort`
 * handler and `toCoachAIError` produce — so both transports have abort parity.
 */
export function mapFetchRejection(err: unknown): DataError {
  if (err instanceof DOMException && err.name === 'AbortError') return timeoutError()
  return networkError()
}

/** Narrow an unknown throw to the data error union (same rule as isCoachAIError). */
export function isDataError(err: unknown): err is DataError {
  if (!err || typeof err !== 'object') return false
  const obj = err as Record<string, unknown>
  return (
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.retryable === 'boolean'
  )
}

/** Retry classifier mirroring `isTransientError`: aborts + `retryable` errors. */
export function isTransientDataError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return isDataError(err) ? err.retryable !== false : false
}

/** Normalize an unknown throw into the union (mirrors `toCoachAIError`). */
export function toDataError(err: unknown): DataError {
  if (err instanceof DOMException && err.name === 'AbortError') return timeoutError()
  if (isDataError(err)) return err
  return unknownError(err)
}

export type { CoachAIError }
