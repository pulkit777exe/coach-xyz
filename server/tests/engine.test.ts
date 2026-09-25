import { afterEach, describe, expect, mock, test } from 'bun:test'
import { isConnectivityError } from '../src/lib/engine'
import type * as Engine from '../src/lib/engine'

// Re-evaluating the module lets each test control process.env.ENGINE_URL at
// import time (engine.ts reads it once at module load). The module only
// imports type-only deps, so a fresh evaluation is side-effect-free.
const loadEngine = (): Promise<typeof Engine> =>
  import(`../src/lib/engine?t=${Date.now()}-${Math.random()}`)

const realFetch = globalThis.fetch
const realEngineUrl = process.env.ENGINE_URL

afterEach(() => {
  globalThis.fetch = realFetch
  if (realEngineUrl === undefined) delete process.env.ENGINE_URL
  else process.env.ENGINE_URL = realEngineUrl
})

describe('ENGINE_URL', () => {
  test('defaults to localhost:8001 when unset', async () => {
    delete process.env.ENGINE_URL
    const mod = await loadEngine()
    expect(mod.ENGINE_URL).toBe('http://localhost:8001')
  })

  test('honors the ENGINE_URL env var', async () => {
    process.env.ENGINE_URL = 'http://engine.internal:8001'
    const mod = await loadEngine()
    expect(mod.ENGINE_URL).toBe('http://engine.internal:8001')
  })
})

describe('withTimeout', () => {
  test('resolves with the response when fetch completes in time', async () => {
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    ) as unknown as typeof fetch

    const res = await mod.withTimeout('http://engine.test/scan', { method: 'POST' }, 5_000)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('aborts the request when the timeout elapses', async () => {
    const mod = await loadEngine()
    globalThis.fetch = mock(
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          )
        }),
    ) as unknown as typeof fetch

    try {
      await mod.withTimeout('http://engine.test/slow', {}, 20)
      expect.unreachable('withTimeout should have aborted')
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
    }
  })
})

describe('isConnectivityError', () => {
  test('classifies TypeError and AbortError as connectivity failures', () => {
    expect(isConnectivityError(new TypeError('fetch failed'))).toBe(true)
    expect(isConnectivityError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  test('classifies network-style message/codes', () => {
    expect(isConnectivityError(new Error('connect ECONNREFUSED 127.0.0.1:8001'))).toBe(true)
    expect(isConnectivityError(new Error('fetch failed', { cause: 'ECONNRESET' }))).toBe(true)
    expect(isConnectivityError({ code: 'ENOTFOUND' })).toBe(true)
    expect(isConnectivityError({ code: 'ECONNREFUSED' })).toBe(true)
  })

  test('rejects unrelated errors and values', () => {
    expect(isConnectivityError(new Error('something else'))).toBe(false)
    expect(isConnectivityError(new RangeError('bad range'))).toBe(false)
    expect(isConnectivityError(null)).toBe(false)
    expect(isConnectivityError('fetch failed')).toBe(false)
  })
})

describe('scanVideo', () => {
  test('POSTs the file and returns the ScanResult', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            session_token: 'tok',
            video_key: 'k',
            player_count: 1,
            players: [],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch

    const result = await mod.scanVideo(new File(['data'], 'clip.mp4'))
    expect(result.session_token).toBe('tok')

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('http://engine.test/scan')
    expect(init.method).toBe('POST')
  })

  test('maps connectivity failures to ENGINE_UNAVAILABLE', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch

    try {
      await mod.scanVideo(new File(['data'], 'clip.mp4'))
      expect.unreachable('scanVideo should have thrown')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'ENGINE_UNAVAILABLE',
        layer: 'engine',
      })
    }
  })
})

describe('getEngineJobStatus', () => {
  test('returns not_found on 404', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as unknown as typeof fetch

    const result = await mod.getEngineJobStatus('j1')
    expect(result).toEqual({ status: 'not_found' })
  })

  test('returns found with the engine status data', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ job_id: 'j1', state: 'scanning' }), {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch

    const result = await mod.getEngineJobStatus('j1')
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.data).toMatchObject({ state: 'scanning' })
  })

  test('returns transient_error on connectivity failures', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch

    const result = await mod.getEngineJobStatus('j1')
    expect(result).toEqual({ status: 'transient_error' })
  })
})

describe('getDownloadStream', () => {
  test('returns the response stream when available', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('video', { status: 200 })),
    ) as unknown as typeof fetch

    const res = await mod.getDownloadStream('j1')
    expect(res.status).toBe(200)
  })

  test('throws JOB_NOT_FOUND on 404', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as unknown as typeof fetch

    try {
      await mod.getDownloadStream('gone')
      expect.unreachable('getDownloadStream should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'JOB_NOT_FOUND' })
    }
  })
})

describe('analyzeVideo', () => {
  test('POSTs the analyze payload to /analyze', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch

    await mod.analyzeVideo({
      engine_job_id: 'j1',
      session_token: 'tok',
      player_index: 2,
      video_key: 'k',
    })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('http://engine.test/analyze')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      engine_job_id: 'j1',
      session_token: 'tok',
      player_index: 2,
      video_key: 'k',
    })
  })

  test("preserves the engine's non-retryable code on failure", async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'JOB_NOT_FOUND',
            message: 'gone',
            layer: 'engine',
            retryable: false,
          }),
          { status: 404 },
        ),
      ),
    ) as unknown as typeof fetch

    try {
      await mod.analyzeVideo({
        engine_job_id: 'gone',
        session_token: null,
        player_index: null,
        video_key: null,
      })
      expect.unreachable('analyzeVideo should have thrown')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'JOB_NOT_FOUND',
        retryable: false,
        layer: 'engine',
      })
    }
  })

  test('maps connectivity failures to retryable ENGINE_UNAVAILABLE', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch

    try {
      await mod.analyzeVideo({
        engine_job_id: 'j1',
        session_token: null,
        player_index: null,
        video_key: null,
      })
      expect.unreachable('analyzeVideo should have thrown')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'ENGINE_UNAVAILABLE',
        retryable: true,
        layer: 'engine',
      })
    }
  })
})

describe('markEngineJobFailed', () => {
  test('resolves when the engine acknowledges the failure', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch

    await mod.markEngineJobFailed('j1', 'boom', 'INTERNAL_ERROR', true)
  })

  test('swallows connectivity errors (best-effort failure reporting)', async () => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('fetch failed')),
    ) as unknown as typeof fetch

    await mod.markEngineJobFailed('j1', 'boom', 'INTERNAL_ERROR', true)
  })
})

describe('throwNonOk opaque bodies (fingerprint, never content)', () => {
  const driveOpaque = async (bodyText: string | null, status: number) => {
    process.env.ENGINE_URL = 'http://engine.test'
    const mod = await loadEngine()
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(bodyText, { status })),
    ) as unknown as typeof fetch

    try {
      await mod.getDownloadStream('j1')
      expect.unreachable('getDownloadStream should have thrown')
    } catch (error) {
      return error as { code?: unknown; layer?: unknown; retryable?: unknown; status?: unknown }
    }
    throw new Error('unreachable')
  }

  // NOTE: getDownloadStream passes defaults { code: 'JOB_NOT_FOUND' }, so opaque
  // bodies surface the endpoint default (not UNKNOWN) — the assertions pin
  // that the error is SHAPED with the stamped status rather than crashing.
  test('literal null JSON body shapes with the stamped status (never a TypeError crash)', async () => {
    const error = await driveOpaque('null', 502)
    expect(error).toMatchObject({
      code: 'JOB_NOT_FOUND',
      layer: 'engine',
      retryable: true,
      status: 502,
    })
  })

  test('proxy HTML body shapes with the stamped status', async () => {
    const error = await driveOpaque('<html><body>Bad Gateway</body></html>', 502)
    expect(error).toMatchObject({ code: 'JOB_NOT_FOUND', layer: 'engine', status: 502 })
  })

  test('JSON array body shapes without crashing', async () => {
    const error = await driveOpaque('[1,2]', 500)
    expect(error).toMatchObject({ code: 'JOB_NOT_FOUND', layer: 'engine', status: 500 })
  })
})
