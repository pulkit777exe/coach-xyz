import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, startAnalysis } from '../api'
import { meStartAnalysis } from '../playerUpload'

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('apiFetch', () => {
  it('returns the parsed JSON for a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    await expect(apiFetch('http://localhost:3000/x')).resolves.toEqual({ ok: true })
  })

  it('sets Content-Type: application/json for non-FormData requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('http://localhost:3000/x', { method: 'POST' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('throws a NETWORK_ERROR client error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      layer: 'client',
      retryable: true,
    })
  })

  it('throws RATE_LIMITED on 429 and surfaces retry_after', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'slow down', retry_after: 42 }, 429)),
    )
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      layer: 'server',
      retryable: true,
      retry_after: 42,
    })
  })

  it('rethrows a structured server error on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'INVALID_REQUEST', message: 'bad', retryable: false }, 400),
        ),
    )
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'bad',
      layer: 'server',
      retryable: false,
    })
  })

  it('falls back to REQUEST_FAILED for non-structured errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 502 })))
    await expect(apiFetch('http://localhost:3000/x')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      layer: 'server',
      retryable: true,
    })
  })
})

describe('startAnalysis cancellation', () => {
  it('propagates caller cancellation to the enqueue request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal
      controller.abort()
      expect(requestSignal.aborted).toBe(true)
      return jsonResponse({ job_id: 'job-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      startAnalysis({
        session_token: 'session-1',
        player_index: 1,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ job_id: 'job-1' })

    expect(requestSignal).not.toBeNull()
  })

  it('propagates caller cancellation to the player enqueue request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal
      controller.abort()
      expect(requestSignal.aborted).toBe(true)
      return jsonResponse({ job_id: 'job-player-1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    // Make apiFetch take its browser branch; the self-scoped route does not
    // need server-side session lookup in this unit test.
    vi.stubGlobal('window', {})

    await expect(
      meStartAnalysis({ session_token: 'session-1', signal: controller.signal }),
    ).resolves.toEqual({ job_id: 'job-player-1' })

    expect(requestSignal).not.toBeNull()
  })
})
