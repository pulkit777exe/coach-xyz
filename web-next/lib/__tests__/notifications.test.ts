import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchNotifications,
  fetchNotificationsWithRetry,
  subscribeNotifications,
} from '../notifications'

const pendingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notification snapshots', () => {
  it('retries a transient snapshot failure within the recovery budget', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notifications: [], unread_count: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const request = fetchNotificationsWithRetry(new AbortController().signal)
    await vi.advanceTimersByTimeAsync(500)
    await expect(request).resolves.toEqual({ notifications: [], unread_count: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a failed snapshot instead of returning an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(fetchNotifications()).rejects.toMatchObject({
      code: 'NOTIFICATIONS_FETCH_FAILED',
      layer: 'server',
      retryable: true,
    })
    // The status stays in the message so the log still says which one it was.
    await expect(fetchNotifications()).rejects.toThrow('503')
  })

  it('does not spend the retry budget on a status that cannot succeed', async () => {
    // The mapping marks 401/403/404 non-retryable. Retrying them three times
    // only delayed the identical failure by 5s before surfacing it.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'no session' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchNotificationsWithRetry(new AbortController().signal)).rejects.toMatchObject({
      code: 'NOTIFICATIONS_FETCH_FAILED',
      retryable: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeNotifications reconnect policy', () => {
  it('starts a new attempt after a stalled connection times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const fetchMock = vi.fn(pendingFetch)
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const onReconnect = vi.fn()
    const stop = subscribeNotifications(vi.fn(), controller.signal, onReconnect)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // A stalled attempt has no established stream, so it must not trigger a
    // snapshot callback; the next successful connection will.
    expect(onReconnect).toHaveBeenCalledTimes(0)

    stop()
  })

  it('reconciles only after a replacement stream is established', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start() {
            // Keep the stream open until the test cleanup aborts it.
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onConnected = vi.fn()
    const stop = subscribeNotifications(vi.fn(), new AbortController().signal, onConnected)
    await Promise.resolve()
    await Promise.resolve()
    expect(onConnected).toHaveBeenCalledTimes(1)
    stop()
  })
})
