import { describe, expect, it, vi } from 'vitest'

import { createAttributionStore } from '../data/attribution'
import { mutateJson, postJob, queryJson, requestJson, withTimeout } from '../data/client'
import {
  isDataError,
  isTransientDataError,
  mapFetchRejection,
  mapResponseError,
  networkError,
  parseError,
  parseXhrJson,
  passthroughError,
  rateLimitedError,
  requestFailedError,
  streamFailureError,
  timeoutError,
  toDataError,
} from '../data/errors'
import type { Transport } from '../data/transport'
import { isTransientError, toCoachAIError } from '../errors'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakeTransport(fetchFn: Transport['fetchFn'], randomId = 'test-request-id'): Transport {
  return {
    fetchFn,
    now: () => 1_000_000,
    randomId: () => randomId,
    xhrFactory: () => {
      throw new Error('xhr unused in this test')
    },
  }
}

describe('data core error mapping (closed union)', () => {
  it('maps a fetch rejection to NETWORK_ERROR', async () => {
    const t = fakeTransport(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, t),
    ).rejects.toEqual(networkError())
  })

  it('maps a 429 to RATE_LIMITED and surfaces retry_after', async () => {
    const body = { message: 'slow down', retry_after: 42 }
    const t = fakeTransport(async () => jsonResponse(body, 429))
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, t),
    ).rejects.toEqual(rateLimitedError(body))
  })

  it('preserves structured server errors instead of collapsing them', async () => {
    const body = { code: 'INVALID_REQUEST', message: 'bad', retryable: false }
    const t = fakeTransport(async () => jsonResponse(body, 400))
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, t),
    ).rejects.toEqual(passthroughError({ ...body }))
  })

  it('falls back to REQUEST_FAILED with status-derived retryability', async () => {
    const badGateway = fakeTransport(async () => new Response('oops', { status: 502 }))
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, badGateway),
    ).rejects.toEqual(requestFailedError(502))

    const badRequest = fakeTransport(async () => new Response('oops', { status: 400 }))
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, badRequest),
    ).rejects.toEqual(requestFailedError(400))
  })

  it('maps a malformed 2xx JSON body to PARSE_ERROR', async () => {
    const t = fakeTransport(async () => new Response('not-json', { status: 200 }))
    await expect(
      requestJson('http://localhost:3000/api/scan-intent', {}, false, t),
    ).rejects.toEqual(parseError())
  })

  it('returns parsed JSON with correlation headers on success', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const t = fakeTransport(async (url, init) => {
      seen.push({ url, init })
      return jsonResponse({ ok: true })
    })
    await expect(
      requestJson<{ ok: boolean }>('http://localhost:3000/api/scan-intent', {}, false, t),
    ).resolves.toEqual({ ok: true })
    const headers = seen[0]?.init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['x-request-id']).toBe('test-request-id')
  })

  it('gives fetch aborts and XHR aborts the same REQUEST_TIMEOUT code', () => {
    expect(mapFetchRejection(new DOMException('aborted', 'AbortError'))).toEqual(timeoutError())
    expect(mapFetchRejection(new TypeError('fetch failed'))).toEqual(networkError())
  })

  it('classifies XHR load events exactly like fetch responses', () => {
    const cases: Array<{ status: number; body: Record<string, unknown> }> = [
      { status: 429, body: { message: 'slow down', retry_after: 42 } },
      { status: 400, body: { code: 'INVALID_REQUEST', message: 'bad', retryable: false } },
      { status: 502, body: {} },
      { status: 400, body: { message: 'no code' } },
    ]
    for (const { status, body } of cases) {
      const xhr = parseXhrJson<unknown>(status, JSON.stringify(body))
      expect(xhr.ok).toBe(false)
      if (!xhr.ok) expect(xhr.error).toEqual(mapResponseError(status, body))
    }
    // Non-JSON error text degrades to the same fallback on both transports.
    const text = parseXhrJson<unknown>(502, 'oops')
    expect(text.ok).toBe(false)
    if (!text.ok) expect(text.error).toEqual(mapResponseError(502, {}))
  })

  it('parses XHR 2xx bodies and maps malformed ones to PARSE_ERROR', () => {
    expect(parseXhrJson(200, '{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseXhrJson(200, 'not json')).toEqual({ ok: false, error: parseError() })
  })

  it('maps stream failures through the shared taxonomy', () => {
    expect(streamFailureError('SCAN_PROGRESS_FAILED', 'Failed to get scan progress.', {})).toEqual({
      code: 'SCAN_PROGRESS_FAILED',
      message: 'Failed to get scan progress.',
      layer: 'server',
      retryable: true,
    })
    expect(
      streamFailureError('CHAT_FAILED', 'Chat request failed.', { message: 'busy' }),
    ).toMatchObject({ code: 'CHAT_FAILED', message: 'busy' })
  })
})

describe('data core taxonomy stays compatible with lib/errors', () => {
  it('passes core errors through toCoachAIError unchanged', () => {
    const retryable = networkError()
    expect(toCoachAIError(retryable)).toBe(retryable)
    const fatal = passthroughError({ code: 'JOB_NOT_FOUND', message: 'gone', retryable: false })
    expect(toCoachAIError(fatal)).toBe(fatal)
    expect(isDataError(fatal)).toBe(true)
    expect(isDataError(null)).toBe(false)
  })

  it('agrees with isTransientError on retryability', () => {
    expect(isTransientError(networkError())).toBe(true)
    expect(isTransientDataError(networkError())).toBe(true)
    expect(isTransientError(parseError())).toBe(false)
    expect(isTransientDataError(parseError())).toBe(false)
    expect(isTransientError(rateLimitedError({}))).toBe(true)
    expect(isTransientError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isTransientDataError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isTransientError(new Error('boom'))).toBe(false)
    expect(isTransientDataError(new Error('boom'))).toBe(false)
  })

  it('normalizes aborts and passes canonical errors through', () => {
    expect(toDataError(new DOMException('aborted', 'AbortError'))).toEqual(timeoutError())
    const canonical = networkError()
    expect(toDataError(canonical)).toBe(canonical)
  })
})

describe('query/mutate declarative split', () => {
  it('queryJson performs declarative reads', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const t = fakeTransport(async (url, init) => {
      seen.push({ url, init })
      return jsonResponse({ ok: true })
    })
    await expect(
      queryJson<{ ok: boolean }>('http://localhost:3000/api/scan-progress/s1', {}, t),
    ).resolves.toEqual({ ok: true })
    expect(seen[0]?.url).toBe('http://localhost:3000/api/scan-progress/s1')
  })

  it('mutateJson POSTs JSON with correlation headers', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const t = fakeTransport(async (url, init) => {
      seen.push({ url, init })
      return jsonResponse({ ok: true })
    })
    await expect(
      mutateJson<{ ok: boolean }>(
        'http://localhost:3000/api/scan-intent',
        'POST',
        { full_name: 'Al' },
        {},
        t,
      ),
    ).resolves.toEqual({ ok: true })
    const first = seen[0]
    expect(first?.url).toBe('http://localhost:3000/api/scan-intent')
    expect(first?.init?.method).toBe('POST')
    expect(JSON.parse(first?.init?.body as string)).toEqual({ full_name: 'Al' })
    expect((first?.init?.headers as Record<string, string>)['x-request-id']).toBe('test-request-id')
  })

  it('withTimeout resolves without aborting fast calls', async () => {
    await expect(
      withTimeout(50, async (signal) => {
        expect(signal.aborted).toBe(false)
        return 'done'
      }),
    ).resolves.toBe('done')
  })
})

describe('attribution-token caching', () => {
  it('mints once per expiry and recovers from failures', async () => {
    let now = 1_000_000
    const mint = vi.fn(async () => ({
      token: `tok-${mint.mock.calls.length}`,
      exp: now + 60_000,
    }))
    const store = createAttributionStore({ fetchMint: mint, now: () => now })

    await expect(store.getToken()).resolves.toBe('tok-1')
    await expect(store.getToken()).resolves.toBe('tok-1')
    expect(mint).toHaveBeenCalledTimes(1)

    now += 61_000
    await expect(store.getToken()).resolves.toBe('tok-2')
    expect(mint).toHaveBeenCalledTimes(2)

    now += 61_000
    mint.mockRejectedValueOnce(new Error('mint down'))
    await expect(store.getToken()).resolves.toBeNull()
    expect(mint).toHaveBeenCalledTimes(3)

    await expect(store.getToken()).resolves.toBe('tok-4')
    expect(mint).toHaveBeenCalledTimes(4)
  })
})

describe('abort + job_id single source (postJob)', () => {
  it('shares one enqueue path for coach- and player-shaped payloads', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const t = fakeTransport(async (url, init) => {
      calls.push({ url, body: JSON.parse(init?.body as string) })
      return jsonResponse({ job_id: 'job-1' })
    })

    await expect(
      postJob(
        'http://localhost:3000/api/analyze-video',
        { session_token: 's', player_index: 0, model: 'gemini-2.5-flash' },
        { timeoutMs: 30_000, headers: { 'x-attribution': 'tok' }, transport: t },
      ),
    ).resolves.toEqual({ job_id: 'job-1' })

    await expect(
      postJob(
        'http://localhost:3000/api/me/analyze',
        { session_token: 's', player_index: null, video_key: null, angle: null },
        { timeoutMs: 30_000, transport: t },
      ),
    ).resolves.toEqual({ job_id: 'job-1' })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.body).toMatchObject({ model: 'gemini-2.5-flash' })
    expect(calls[1]?.url).toBe('http://localhost:3000/api/me/analyze')
  })

  it('maps a timeout abort to REQUEST_TIMEOUT', async () => {
    const t = fakeTransport(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await expect(
      postJob(
        'http://localhost:3000/api/analyze-video',
        { session_token: 's' },
        { timeoutMs: 10, transport: t },
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', layer: 'client', retryable: true })
  })
})
