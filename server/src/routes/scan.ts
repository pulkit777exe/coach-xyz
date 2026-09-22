import { Elysia } from 'elysia'

import {
  scanVideo,
  getScanProgressStream,
  requestUploadIntent,
  scanFromKey,
  requestIdFrom,
} from '../lib/engine'
import { buildError, isCoachAIError } from '../lib/errors'
import { readRequestMeta } from '../lib/requestMeta'
import { resolveJobCaller } from '../lib/jobAccess'
import { checkScanLimit, checkScanProgressLimit, getIP } from '../lib/ratelimit'
import { verifyAttributionToken } from '../lib/attribution'
import {
  persistVideoConversation,
} from '../lib/analyses'
import { MAX_FILE_SIZE_BYTES } from '../types'

const scanErrorStatus = (code: string): number => {
  switch (code) {
    case 'NO_PLAYERS_DETECTED':
      return 422
    case 'VIDEO_DECODE_FAILED':
      return 422
    case 'ENGINE_UNAVAILABLE':
      return 503
    case 'MEDIAPIPE_UNAVAILABLE':
      return 503
    case 'INVALID_REQUEST':
      return 400
    default:
      return 500
  }
}

export default new Elysia()
  .post('/api/scan-video', async ({ request, set }) => {
    // ── Rate Limiting ──────────────────────────────────────────────────────
    // Key by verified sub when the caller sent a signed attribution token —
    // unlike X-Forwarded-For, the sub cannot be spoofed, so logged-in callers
    // get a per-account bucket and cannot rotate IPs to evade the limit.
    const ip = getIP(request)
    const { allowed, remaining, reset } = await checkScanLimit(resolveJobCaller(request) ?? ip)
    set.headers['X-RateLimit-Remaining'] = String(remaining)
    if (!allowed) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000)
      set.status = 429
      return {
        ...buildError(
          'RATE_LIMITED',
          'Too many scan requests. Wait a minute before trying again.',
          true,
        ),
        retry_after: retryAfter,
      }
    }

    // ── Reject oversized uploads before buffering into memory ─────────────
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      set.status = 413
      return buildError('FILE_TOO_LARGE', 'File must be under 500MB.', false)
    }

    // ── Validate Request ───────────────────────────────────────────────────
    const form = await request.formData()
    const value = form.get('video')
    const requestMeta = readRequestMeta(request)
    // Multi-angle flow: the web appends these fields when adding another
    // camera perspective to an existing session.
    const appendSessionToken =
      typeof form.get('session_token') === 'string' ? (form.get('session_token') as string) : null
    const angleLabel = typeof form.get('angle') === 'string' ? (form.get('angle') as string) : null

    if (!(value instanceof File)) {
      set.status = 400
      return buildError('NO_FILE', 'No video file provided.', false)
    }

    if (!value.type.startsWith('video/')) {
      set.status = 400
      return buildError('INVALID_FILE_TYPE', 'Please upload a video file.', false)
    }

    if (value.size > MAX_FILE_SIZE_BYTES) {
      set.status = 413
      return buildError('FILE_TOO_LARGE', 'File must be under 500MB.', false)
    }

    // ── Call Engine ────────────────────────────────────────────────────────
    try {
      const result = await scanVideo(
        value,
        {
          sessionToken: appendSessionToken,
          angle: angleLabel,
        },
        requestIdFrom(request),
      )

      await persistVideoConversation({
        ...requestMeta,
        sessionToken: result.session_token,
        fileName: value.name || 'unknown',
        fileMimeType: value.type || 'application/octet-stream',
        fileSizeBytes: value.size,
        playerCount: result.player_count,
        players: result.players,
        scanResponse: result as Record<string, unknown>,
        auth0Id: verifyAttributionToken(request.headers.get('x-attribution')),
      })

      set.status = 200
      return result
    } catch (error) {
      // If the engine returned a structured error, pass it through
      if (isCoachAIError(error)) {
        set.status = scanErrorStatus(error.code)
        return error
      }

      // Unknown error — normalize to a safe code (don't leak raw Bun/OS error codes or messages)
      const routeError = error as { code?: string; message?: string }
      const code = 'INTERNAL_ERROR'
      console.error(
        JSON.stringify({
          type: 'scan_unknown_error',
          code: String(routeError?.code ?? 'UNKNOWN'),
          message: String(routeError?.message ?? 'unknown'),
          timestamp: new Date().toISOString(),
        }),
      )
      set.status = 500
      return buildError(code, 'Video scan failed. Please try again.')
    }
  })
  // ── Direct-to-storage upload intents (§8) ──────────────────────────────
  // Validates metadata + rate limit up front, then mints a namespaced key.
  // The browser uploads straight to storage (presigned POST on S3, or the
  // local multipart /scan-video path) and finishes with /api/scan-from-key.
  .post('/api/scan-intent', async ({ request, set }) => {
    const ip = getIP(request)
    const { allowed, remaining, reset } = await checkScanLimit(resolveJobCaller(request) ?? ip)
    set.headers['X-RateLimit-Remaining'] = String(remaining)
    if (!allowed) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000)
      set.status = 429
      return {
        ...buildError(
          'RATE_LIMITED',
          'Too many scan requests. Wait a minute before trying again.',
          true,
        ),
        retry_after: retryAfter,
      }
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
    }

    const filename = body.filename
    const mimeType = body.mime_type ?? body.mimeType
    const sizeBytes = body.size_bytes ?? body.sizeBytes
    if (typeof filename !== 'string' || !filename.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'filename is required.', false)
    }
    if (typeof mimeType !== 'string' || !mimeType.startsWith('video/')) {
      set.status = 400
      return buildError('INVALID_FILE_TYPE', 'Please upload a video file.', false)
    }
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'size_bytes must be a positive number.', false)
    }
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      set.status = 413
      return buildError('FILE_TOO_LARGE', 'File must be under 500MB.', false)
    }

    const sessionToken = typeof body.session_token === 'string' ? body.session_token : null
    const angle = typeof body.angle === 'string' ? body.angle : null

    try {
      const intent = await requestUploadIntent(
        {
          filename,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          session_token: sessionToken,
          angle,
        },
        requestIdFrom(request),
      )
      set.status = 200
      return intent
    } catch (error) {
      if (isCoachAIError(error)) {
        set.status = scanErrorStatus(error.code)
        return error
      }
      set.status = 500
      return buildError(
        'INTERNAL_ERROR',
        'Could not create an upload slot. Please try again.',
        true,
      )
    }
  })
  // ── Scan an already-uploaded key (§8) ──────────────────────────────────
  // Completes the direct-upload flow: the key must match an intent-minted
  // shape (raw/…) so result keys and arbitrary paths are rejected.
  .post('/api/scan-from-key', async ({ request, set }) => {
    const ip = getIP(request)
    const { allowed, remaining, reset } = await checkScanLimit(resolveJobCaller(request) ?? ip)
    set.headers['X-RateLimit-Remaining'] = String(remaining)
    if (!allowed) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000)
      set.status = 429
      return {
        ...buildError(
          'RATE_LIMITED',
          'Too many scan requests. Wait a minute before trying again.',
          true,
        ),
        retry_after: retryAfter,
      }
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
    }

    const storageKey = body.storage_key
    if (
      typeof storageKey !== 'string' ||
      !/^raw\/[A-Za-z0-9_@.|-]+\/[a-z0-9_-]+\/[a-f0-9]{32}\.mp4$/.test(storageKey)
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'storage_key must be an upload-intent key.', false)
    }
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : null
    const angle = typeof body.angle === 'string' ? body.angle : null

    const requestMeta = readRequestMeta(request)
    try {
      const result = await scanFromKey(
        { storage_key: storageKey, session_token: sessionToken, angle },
        requestIdFrom(request),
      )
      await persistVideoConversation({
        ...requestMeta,
        sessionToken: result.session_token,
        fileName: 'direct-upload',
        fileMimeType: 'video/mp4',
        fileSizeBytes: 0,
        playerCount: result.player_count,
        players: result.players,
        scanResponse: result as Record<string, unknown>,
        auth0Id: verifyAttributionToken(request.headers.get('x-attribution')),
      })
      set.status = 200
      return result
    } catch (error) {
      if (isCoachAIError(error)) {
        set.status = scanErrorStatus(error.code)
        return error
      }
      const routeError = error as { code?: string; message?: string }
      console.error(
        JSON.stringify({
          type: 'scan_from_key_error',
          code: String(routeError?.code ?? 'UNKNOWN'),
          message: String(routeError?.message ?? 'unknown'),
          timestamp: new Date().toISOString(),
        }),
      )
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Video scan failed. Please try again.', true)
    }
  })
  .get('/api/scan-progress/:sessionToken', async ({ params, request, set }) => {
    const { sessionToken } = params

    if (!sessionToken) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'sessionToken required.', false)
    }

    const { allowed, reset } = await checkScanProgressLimit(getIP(request))
    if (!allowed) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000)
      set.status = 429
      return {
        ...buildError('RATE_LIMITED', 'Too many scan-progress requests. Try again later.', true),
        retry_after: retryAfter,
      }
    }

    // Multi-angle sessions track each perspective separately — forward the
    // requested angle so parallel scans don't share one progress slot.
    const angle = new URL(request.url).searchParams.get('angle')
    try {
      const engineRes = await getScanProgressStream(sessionToken, angle, requestIdFrom(request))

      // Proxy the SSE stream from the engine
      return new Response(engineRes.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    } catch (error) {
      if (isCoachAIError(error)) {
        set.status = error.retryable ? 503 : 500
        return error
      }

      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to get scan progress.')
    }
  })
