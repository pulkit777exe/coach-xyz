import { describe, expect, test, afterAll, afterEach, beforeAll } from 'bun:test'
import {
  buildError,
  chatEngineStatus,
  enginePassthroughStatus,
  errorBody,
  FALLBACK_MESSAGES,
  isCoachAIError,
  isQueueRetryable,
  wrapEngineError,
} from '../src/lib/errors'
import type { CoachAIError } from '../src/lib/errors'
import { analyzeVideo, scanVideo } from '../src/lib/engine'
import scanRoute from '../src/routes/scan'
import { downloadRoute } from '../src/routes/download'
import { statusRoute, type StatusRouteDeps } from '../src/routes/status'
import type { ServerJob } from '../src/lib/jobs'

describe('isQueueRetryable', () => {
  test('retries retryable engine errors', () => {
    expect(isQueueRetryable({ retryable: true })).toBe(true)
  })

  test('does not retry errors the engine marks non-retryable', () => {
    expect(isQueueRetryable({ retryable: false })).toBe(false)
  })

  test('defaults to retryable when the flag is absent', () => {
    expect(isQueueRetryable({} as CoachAIError)).toBe(true)
  })
})

describe('engine retryability contract', () => {
  // The engine owns the retryable flag (engine/core/errors.py). These codes
  // must be non-retryable so the queue stops re-deriving policy. Pinned
  // against the engine's registry in test_errors.py.
  const UNRECOVERABLE = [
    'VIDEO_DECODE_FAILED',
    'VIDEO_EXPIRED',
    'VIDEO_NOT_FOUND',
    'JOB_NOT_FOUND',
    'INVALID_REQUEST',
    'MEDIAPIPE_UNAVAILABLE',
  ]

  test('unrecoverable codes are never queue-retryable', () => {
    for (const code of UNRECOVERABLE) {
      expect(isQueueRetryable({ retryable: false }), code).toBe(false)
    }
  })

  test('transient failures stay retryable end to end', () => {
    const err = wrapEngineError({
      code: 'GEMINI_TIMEOUT',
      message: 'took too long',
      retryable: true,
    })
    expect(isQueueRetryable(err)).toBe(true)
  })
})

describe('buildError', () => {
  test('uses the fallback message for a known code', () => {
    const err = buildError('RATE_LIMITED')
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.message).toBe('Too many requests. Please wait before trying again.')
    expect(err.layer).toBe('server')
    expect(err.retryable).toBe(true)
  })

  test('falls back to a generic message for unknown codes', () => {
    expect(buildError('NOPE_NOT_A_CODE').message).toBe('Something went wrong.')
  })

  test('honors an override message and retryable flag', () => {
    const err = buildError('ENGINE_ERROR', 'custom message', false)
    expect(err).toEqual({
      code: 'ENGINE_ERROR',
      message: 'custom message',
      layer: 'server',
      retryable: false,
    })
  })

  test('defaults retryable to true', () => {
    expect(buildError('INTERNAL_ERROR').retryable).toBe(true)
  })
})

describe('wrapEngineError', () => {
  test('preserves engine code, message, and retryable', () => {
    const err = wrapEngineError({
      code: 'NO_PLAYERS_DETECTED',
      message: 'no players',
      retryable: false,
    })
    expect(err).toEqual({
      code: 'NO_PLAYERS_DETECTED',
      message: 'no players',
      layer: 'engine',
      retryable: false,
    })
  })

  test('fills defaults for partial engine bodies', () => {
    const err = wrapEngineError({})
    expect(err).toEqual({
      code: 'ENGINE_ERROR',
      message: 'Analysis engine is temporarily unavailable.',
      layer: 'engine',
      retryable: true,
    })
  })
})

describe('isCoachAIError', () => {
  const valid: CoachAIError = {
    code: 'X',
    message: 'm',
    layer: 'engine',
    retryable: true,
  }

  test('accepts a well-formed CoachAIError', () => {
    expect(isCoachAIError(valid)).toBe(true)
    expect(isCoachAIError({ ...valid, layer: 'server' })).toBe(true)
    expect(isCoachAIError({ ...valid, layer: 'client' })).toBe(true)
  })

  test('rejects non-objects', () => {
    expect(isCoachAIError(null)).toBe(false)
    expect(isCoachAIError(undefined)).toBe(false)
    expect(isCoachAIError('nope')).toBe(false)
    expect(isCoachAIError(42)).toBe(false)
  })

  test('rejects the wrong shape', () => {
    expect(isCoachAIError({ code: 'X', message: 'm' })).toBe(false)
    expect(
      isCoachAIError({
        code: 'X',
        message: 'm',
        layer: 'engine',
        retryable: 'yes',
      }),
    ).toBe(false)
    expect(isCoachAIError({ code: 'X', message: 'm', layer: 'db', retryable: true })).toBe(false)
    expect(
      isCoachAIError({
        code: 1,
        message: 'm',
        layer: 'engine',
        retryable: true,
      }),
    ).toBe(false)
  })
})

// ── Engine ↔ server status/retryable parity ─────────────────────────────────
// The ENGINE owns code → HTTP status (STATUS_BY_CODE) and code → retryable
// (RETRYABLE_BY_CODE) in engine/core/errors.py. The tables below are MIRRORS,
// pinned from both sides: engine/tests/test_errors.py asserts the engine's
// own tables, these tests assert the server derives the same answers from the
// WIRE (lib/engine's throwNonOk stamps the response status on the thrown
// CoachAIError) instead of re-mapping codes itself.

const ENGINE_STATUS_BY_CODE: Record<string, number> = {
  NO_PLAYERS_DETECTED: 400,
  VIDEO_DECODE_FAILED: 400,
  VIDEO_EXPIRED: 400,
  VIDEO_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  GEMINI_QUOTA_EXCEEDED: 429,
  GEMINI_TIMEOUT: 504,
  GEMINI_PARSE_FAILED: 500,
  GEMINI_PROCESSING_FAILED: 500,
  MEDIAPIPE_UNAVAILABLE: 503,
  REDIS_UNAVAILABLE: 503,
  STORAGE_ERROR: 503,
  ENGINE_UNAVAILABLE: 503,
}

const ENGINE_RETRYABLE_BY_CODE: Record<string, boolean> = {
  NO_PLAYERS_DETECTED: true,
  VIDEO_DECODE_FAILED: false,
  VIDEO_EXPIRED: false,
  VIDEO_NOT_FOUND: false,
  JOB_NOT_FOUND: false,
  INVALID_REQUEST: false,
  INVALID_STATE_TRANSITION: false,
  GEMINI_QUOTA_EXCEEDED: true,
  GEMINI_TIMEOUT: true,
  GEMINI_PARSE_FAILED: true,
  GEMINI_PROCESSING_FAILED: true,
  MEDIAPIPE_UNAVAILABLE: false,
  REDIS_UNAVAILABLE: false,
  STORAGE_ERROR: true,
  ENGINE_UNAVAILABLE: true,
}

const realFetch = globalThis.fetch
const realScanRateLimit = process.env.SCAN_RATE_LIMIT
const realDownloadRateLimit = process.env.DOWNLOAD_RATE_LIMIT

beforeAll(() => {
  // Rate-limit counters live in Redis (and the in-memory fallback) across
  // runs — pin the limits high so repeat runs never trip 429 mid-suite.
  process.env.SCAN_RATE_LIMIT = '10000'
  process.env.DOWNLOAD_RATE_LIMIT = '10000'
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  if (realScanRateLimit === undefined) delete process.env.SCAN_RATE_LIMIT
  else process.env.SCAN_RATE_LIMIT = realScanRateLimit
  if (realDownloadRateLimit === undefined) delete process.env.DOWNLOAD_RATE_LIMIT
  else process.env.DOWNLOAD_RATE_LIMIT = realDownloadRateLimit
})

const engineBody = (code: string, retryable: boolean, message?: string) => ({
  code,
  message: message ?? `engine says: ${code}`,
  layer: 'engine',
  retryable,
})

const mockFetchJson = (status: number, body: Record<string, unknown>): void => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch
}

const mockFetchReject = (): void => {
  globalThis.fetch = (() =>
    Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
}

async function caught(fn: () => Promise<unknown>): Promise<CoachAIError> {
  try {
    await fn()
  } catch (error) {
    return error as CoachAIError
  }
  throw new Error('expected the call to throw')
}

const scanFile = (): File => new File(['x'], 'clip.mp4', { type: 'video/mp4' })

describe('errorBody', () => {
  test('strips the internal status stamp, keeping only the 4 wire fields', () => {
    const stamped = {
      ...wrapEngineError({ code: 'NO_PLAYERS_DETECTED', message: 'x', retryable: true }),
      status: 400,
    }
    expect(errorBody(stamped)).toEqual({
      code: 'NO_PLAYERS_DETECTED',
      message: 'x',
      layer: 'engine',
      retryable: true,
    })
    expect('status' in errorBody(stamped)).toBe(false)
  })
})

describe('engine status pass-through (lib/engine)', () => {
  test('every registered code passes the engine’s own status through unchanged', async () => {
    for (const [code, status] of Object.entries(ENGINE_STATUS_BY_CODE)) {
      mockFetchJson(status, engineBody(code, ENGINE_RETRYABLE_BY_CODE[code] ?? true))
      const err = await caught(() => scanVideo(scanFile()))
      expect(err.code, code).toBe(code)
      expect(err.status, code).toBe(status) // stamped at the wire
      expect(enginePassthroughStatus(err), code).toBe(status) // route posture echoes it
    }
  })

  test('NO_PLAYERS_DETECTED is 400 (the engine registry), not the retired server-side 422', async () => {
    mockFetchJson(400, engineBody('NO_PLAYERS_DETECTED', true))
    const err = await caught(() => scanVideo(scanFile()))
    expect(enginePassthroughStatus(err)).toBe(400)
    expect(enginePassthroughStatus(err)).not.toBe(422)
  })

  test('statusless errors: ENGINE_UNAVAILABLE → 503, others take the per-route fallback', () => {
    const unavailable = wrapEngineError({ code: 'ENGINE_UNAVAILABLE' })
    expect(enginePassthroughStatus(unavailable)).toBe(503) // scan default
    expect(enginePassthroughStatus(unavailable, 503)).toBe(503) // download
    const other = wrapEngineError({ code: 'SOMETHING_NEW' })
    expect(enginePassthroughStatus(other)).toBe(500) // scan default
    expect(enginePassthroughStatus(other, 503)).toBe(503) // download
  })
})

describe('chatEngineStatus (the chat posture)', () => {
  const stamped = (status: number): CoachAIError => ({
    ...wrapEngineError({ code: 'GEMINI_ERROR', message: 'm' }),
    status,
  })

  test('4xx engine statuses pass through (400/404/429)', () => {
    for (const status of [400, 404, 429]) {
      expect(chatEngineStatus(stamped(status))).toBe(status)
    }
  })

  test('5xx engine statuses become 502 (500/504)', () => {
    expect(chatEngineStatus(stamped(500))).toBe(502)
    expect(chatEngineStatus(stamped(504))).toBe(502)
  })

  test('statusless → null (the engine never answered; route applies its own fallback)', () => {
    expect(chatEngineStatus(wrapEngineError({ code: 'ENGINE_UNAVAILABLE' }))).toBeNull()
  })
})

describe('queue retryable parity (the wire flag, never the status)', () => {
  const analyze = () =>
    analyzeVideo({
      engine_job_id: 'eng-1',
      session_token: null,
      player_index: null,
      video_key: 'raw/org/job/abcdef.mp4',
    })

  test('the wire retryable flag wins over a discordant HTTP status for every registered code', async () => {
    for (const [code, retryable] of Object.entries(ENGINE_RETRYABLE_BY_CODE)) {
      // Deliberately discordant: a status-based rule (>= 500) would answer
      // the opposite of the registry for each of these pairs.
      const status = retryable ? 422 : 500
      mockFetchJson(status, engineBody(code, retryable))
      const err = await caught(analyze)
      expect(err.retryable, code).toBe(retryable)
      expect(isQueueRetryable(err), code).toBe(retryable)
      expect(err.status, code).toBe(status) // the stamp never leaks into retryable
    }
  })

  test('GEMINI_QUOTA_EXCEEDED at 429 is wire-retryable (the one materialized retryable change)', async () => {
    mockFetchJson(429, engineBody('GEMINI_QUOTA_EXCEEDED', true))
    const err = await caught(analyze)
    expect(err.retryable).toBe(true)
    expect(isQueueRetryable(err)).toBe(true)
    expect(err.status).toBe(429)
  })
})

describe('/api/scan-video status pass-through (route)', () => {
  const scanRequest = (): Request => {
    const form = new FormData()
    form.append('video', scanFile())
    return new Request('http://localhost/api/scan-video', { method: 'POST', body: form })
  }

  test('NO_PLAYERS_DETECTED answers 400 (engine) — was 422 — with a status-free 4-field body', async () => {
    mockFetchJson(400, engineBody('NO_PLAYERS_DETECTED', true))
    const res = await scanRoute.handle(scanRequest())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(engineBody('NO_PLAYERS_DETECTED', true))
  })

  test('GEMINI_QUOTA_EXCEEDED answers 429 (engine) — was 500 — with the engine body', async () => {
    mockFetchJson(429, engineBody('GEMINI_QUOTA_EXCEEDED', true))
    const res = await scanRoute.handle(scanRequest())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual(engineBody('GEMINI_QUOTA_EXCEEDED', true))
  })

  test('engine connectivity loss answers 503 ENGINE_UNAVAILABLE (statusless)', async () => {
    mockFetchReject()
    const res = await scanRoute.handle(scanRequest())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      code: 'ENGINE_UNAVAILABLE',
      message: 'Analysis engine is temporarily unavailable.',
      layer: 'engine',
      retryable: true,
    })
  })
})

describe('/api/download status pass-through (route)', () => {
  const job: ServerJob = {
    server_job_id: 'srv-1',
    engine_job_id: 'eng-1',
    session_token: null,
    player_index: null,
    model: 'gemini-2.5-flash',
    created_at: 1,
    owner_ids: [],
  }
  const getReq = (): Request => new Request('http://localhost/api/download/srv-1')

  test('VIDEO_EXPIRED passes the engine message through at the engine status', async () => {
    mockFetchJson(404, engineBody('VIDEO_EXPIRED', false, FALLBACK_MESSAGES.VIDEO_EXPIRED))
    const res = await downloadRoute({ getJob: async () => job }).handle(getReq())
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      code: 'VIDEO_EXPIRED',
      message: FALLBACK_MESSAGES.VIDEO_EXPIRED,
      layer: 'engine',
      retryable: false,
    })
    expect('status' in body).toBe(false)
  })

  test('engine JOB_NOT_FOUND passes the engine message through at 404', async () => {
    mockFetchJson(404, engineBody('JOB_NOT_FOUND', false, 'Job not found'))
    const res = await downloadRoute({ getJob: async () => job }).handle(getReq())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(engineBody('JOB_NOT_FOUND', false, 'Job not found'))
  })

  test('connectivity loss keeps the canonical 503 ENGINE_UNAVAILABLE', async () => {
    mockFetchReject()
    const res = await downloadRoute({ getJob: async () => job }).handle(getReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      code: 'ENGINE_UNAVAILABLE',
      message: 'Analysis engine is temporarily unavailable.',
      layer: 'engine',
      retryable: true,
    })
  })

  test('unknown local job still answers 404 JOB_NOT_FOUND (route-owned, pre-engine)', async () => {
    const res = await downloadRoute({ getJob: async () => null }).handle(getReq())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      code: 'JOB_NOT_FOUND',
      message: 'Analysis session not found.',
      layer: 'server',
      retryable: false,
    })
  })
})

describe('/api/job-status JOB_NOT_FOUND retryable parity (both wire paths)', () => {
  // One code, one meaning: a not-found/expired job is terminal on BOTH
  // paths — the 404 (unknown job) and the 200-poll expired answer — because
  // polling again cannot fix it. The web keys its expired-state UX on
  // error_code and its retry branch on retryable.
  const job: ServerJob = {
    server_job_id: 'srv-nf',
    engine_job_id: 'eng-nf',
    session_token: null,
    player_index: null,
    model: 'gemini-2.5-flash',
    created_at: 1,
    owner_ids: [],
  }
  const req = (): Request => new Request('http://localhost/api/job-status/srv-nf')
  type PersistArgs = Parameters<NonNullable<StatusRouteDeps['persistAnalysisStatus']>>

  test('engine connectivity loss answers retryable 503 instead of a synthetic 200', async () => {
    mockFetchReject()
    const route = statusRoute({ getJob: async () => job })
    const res = await route.handle(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      code: 'ENGINE_UNAVAILABLE',
      message: 'Analysis engine is temporarily unavailable.',
      layer: 'server',
      retryable: true,
    })
  })

  test('unknown job answers 404 with retryable: false', async () => {
    const route = statusRoute({
      getJob: async () => null,
      getAnalysisByServerJobId: async () => null,
    })
    const res = await route.handle(req())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      code: 'JOB_NOT_FOUND',
      message: 'Analysis session not found.',
      layer: 'server',
      retryable: false,
    })
  })

  test('engine-expired job answers 200 failed with retryable: false and persists the same', async () => {
    mockFetchJson(404, engineBody('JOB_NOT_FOUND', false))
    const persisted: PersistArgs[0][] = []
    const route = statusRoute({
      getJob: async () => job,
      persistAnalysisStatus: async (record) => {
        persisted.push(record)
      },
    })
    const res = await route.handle(req())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      state: string
      error_code: string | null
      retryable: boolean
    }
    expect(body.state).toBe('failed')
    expect(body.error_code).toBe('JOB_NOT_FOUND')
    expect(body.retryable).toBe(false)
    // The persisted failed status carries the same verdict for later polls
    // once the Redis key expires (the persisted branch answers false too).
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.status.error_code).toBe('JOB_NOT_FOUND')
    expect(persisted[0]?.status.retryable).toBe(false)
  })
})
