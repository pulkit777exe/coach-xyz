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
import { checkScanLimit, checkScanProgressLimit } from '../lib/ratelimit'
import { capabilityLimitKey, gateRateLimit, mapEngineError, readJsonBody } from '../lib/capability'
import { verifyAttributionToken } from '../lib/attribution'
import { persistVideoConversation } from '../lib/analyses'
import { registerVideo, updateVideoProbe } from '../lib/registry'
import { listMembershipsForUser } from '../lib/orgMembers'
import { MAX_FILE_SIZE_BYTES } from '../types'
import type { ScanResult } from '../types'

/** Best-effort org attribution for uploads (primary membership, else the sub). */
const resolveUploadOrg = async (request: Request): Promise<string | null> => {
  const owner = verifyAttributionToken(request.headers.get('x-attribution'))
  if (!owner) return null
  const memberships = await listMembershipsForUser(owner).catch(() => [])
  return memberships?.[0]?.org_auth0_id ?? owner
}

// ── Shared scan-result persistence ───────────────────────────────────────
// Both upload paths (multipart + direct key) land here: history row plus
// the video registry probe update.
const persistScanResult = async (
  request: Request,
  result: ScanResult,
  file: { name: string; type: string; size: number },
) => {
  const auth0Id = verifyAttributionToken(request.headers.get('x-attribution'))
  await persistVideoConversation({
    ...readRequestMeta(request),
    sessionToken: result.session_token,
    fileName: file.name,
    fileMimeType: file.type,
    fileSizeBytes: file.size,
    playerCount: result.player_count,
    players: result.players,
    scanResponse: result as Record<string, unknown>,
    auth0Id,
  })
  await updateVideoProbe(result.video_key, {
    status: 'ready',
    duration_s: result.media?.duration ?? null,
    width: result.media?.width ?? null,
    height: result.media?.height ?? null,
    has_audio: result.media?.has_audio ?? null,
  }).catch(() => null)
}

export default new Elysia()
  .post('/api/scan-video', async ({ request, set }) => {
    // ── Rate Limiting ──────────────────────────────────────────────────────
    // Key by verified sub when the caller sent a signed attribution token —
    // unlike X-Forwarded-For, the sub cannot be spoofed, so logged-in callers
    // get a per-account bucket and cannot rotate IPs to evade the limit.
    const gate = await gateRateLimit(request, set, {
      check: () => checkScanLimit(capabilityLimitKey(request)),
      deniedMessage: 'Too many scan requests. Wait a minute before trying again.',
    })
    if (!gate.proceed) {
      set.status = gate.status
      return gate.body
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

      await persistScanResult(request, result, {
        name: value.name || 'unknown',
        type: value.type || 'application/octet-stream',
        size: value.size,
      })

      set.status = 200
      return result
    } catch (error) {
      return mapEngineError(set, error, {
        logType: 'scan_unknown_error',
        unknownMessage: 'Video scan failed. Please try again.',
      })
    }
  })
  // ── Direct-to-storage upload intents (§8) ──────────────────────────────
  // Validates metadata + rate limit up front, then mints a namespaced key.
  // The browser uploads straight to storage (presigned POST on S3, or the
  // local multipart /scan-video path) and finishes with /api/scan-from-key.
  .post('/api/scan-intent', async ({ request, set }) => {
    const gate = await gateRateLimit(request, set, {
      check: () => checkScanLimit(capabilityLimitKey(request)),
      deniedMessage: 'Too many scan requests. Wait a minute before trying again.',
    })
    if (!gate.proceed) {
      set.status = gate.status
      return gate.body
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      set.status = 400
      return parsed.body
    }
    const body = parsed.body

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
      await registerVideo({
        orgAuth0Id: await resolveUploadOrg(request),
        storageKey: intent.key,
        sessionToken: intent.session_token,
        fileName: filename.trim(),
        mimeType,
        sizeBytes,
        uploadedBy: verifyAttributionToken(request.headers.get('x-attribution')),
      }).catch(() => null)
      set.status = 200
      return intent
    } catch (error) {
      return mapEngineError(set, error, {
        logType: 'scan_intent_error',
        unknownMessage: 'Could not create an upload slot. Please try again.',
      })
    }
  })
  // ── Scan an already-uploaded key (§8) ──────────────────────────────────
  // Completes the direct-upload flow: the key must match an intent-minted
  // shape (raw/…) so result keys and arbitrary paths are rejected.
  .post('/api/scan-from-key', async ({ request, set }) => {
    const gate = await gateRateLimit(request, set, {
      check: () => checkScanLimit(capabilityLimitKey(request)),
      deniedMessage: 'Too many scan requests. Wait a minute before trying again.',
    })
    if (!gate.proceed) {
      set.status = gate.status
      return gate.body
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) {
      set.status = 400
      return parsed.body
    }
    const body = parsed.body

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
      await persistScanResult(request, result, {
        name: 'direct-upload',
        type: 'video/mp4',
        size: 0,
      })
      set.status = 200
      return result
    } catch (error) {
      return mapEngineError(set, error, {
        logType: 'scan_from_key_error',
        unknownMessage: 'Video scan failed. Please try again.',
      })
    }
  })
  .get('/api/scan-progress/:sessionToken', async ({ params, request, set }) => {
    const { sessionToken } = params

    if (!sessionToken) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'sessionToken required.', false)
    }

    // Keyed on the session token, not the client IP (see checkScanProgressLimit).
    const { allowed, reset } = await checkScanProgressLimit(sessionToken)
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
