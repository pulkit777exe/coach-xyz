import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchNotifications, subscribeNotifications } from '../notifications'

const pendingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notification snapshots', () => {
  it('rejects a failed snapshot instead of returning an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(fetchNotifications()).rejects.toThrow('503')
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
