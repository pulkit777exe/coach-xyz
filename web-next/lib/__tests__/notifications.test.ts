import { afterEach, describe, expect, it, vi } from 'vitest'

import { subscribeNotifications } from '../notifications'

const pendingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
    const stop = subscribeNotifications(vi.fn(), controller.signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    stop()
  })
})
