import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthorizedDownloadUrl, getDownloadUrl, getJobStatus, requestScanIntent } from '../scan'
import { getConversation, sendHistoryChatMessage } from '../chat'
import {
  cancelAnalysis,
  createClip,
  deleteClip,
  getDashboardAnalyses,
  getDashboardStats,
  getFindingsTrends,
  listClips,
  renameAnalysis,
  reviewFinding,
} from '../library'
import { getUserProfile, syncUser } from '../user'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

describe('scan facade', () => {
  it('posts scan intent metadata to the capability route', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ key: 'k' }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

    await requestScanIntent(file, null, { sessionToken: 's1', angle: 'left' })

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/scan-intent')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({
      filename: 'clip.mp4',
      session_token: 's1',
      angle: 'left',
    })
  })

  it('polls job status by id', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ state: 'analyzing' }))
    vi.stubGlobal('fetch', fetchMock)

    await getJobStatus('job-1')

    const [url] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/job-status/job-1')
  })

  it('builds download URLs, appending attribution when mintable', async () => {
    expect(getDownloadUrl('job-1')).toBe('/api/download/job-1')

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ token: 'tok', exp: Date.now() + 60_000 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthorizedDownloadUrl('job-1')).resolves.toBe(
      '/api/download/job-1?attribution=tok',
    )
  })
})

describe('chat facade', () => {
  it('reads the persisted conversation by job', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ messages: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await getConversation('job-1')

    const [url] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/conversation/job-1')
  })

  it('posts history chat messages with the message body', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ message: 'hi', role: 'coach' }))
    vi.stubGlobal('fetch', fetchMock)

    await sendHistoryChatMessage('auth|1', 'job-1', 'hello')

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/auth/user/auth%7C1/analyses/job-1/chat')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hello' })
  })
})

describe('library facade', () => {
  it('reads dashboard stats for the caller', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ stats: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await getDashboardStats('auth|1')

    const [url] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/auth/user/auth%7C1/stats')
  })

  it('forwards the unlinked filter on analyses', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ analyses: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await getDashboardAnalyses('auth|1', 20, 0, { unlinked: true })

    const [url] = lastCall(fetchMock)
    expect(url).toContain('unlinked=1')
  })

  it('builds findings-trend query params', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ trends: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await getFindingsTrends('auth|1', { days: 30, category: 'technique' })

    const [url] = lastCall(fetchMock)
    expect(url).toContain('/findings/trends?')
    expect(url).toContain('days=30')
    expect(url).toContain('category=technique')
  })

  it('patches finding review state', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ id: 'f1', review_state: 'approved' }))
    vi.stubGlobal('fetch', fetchMock)

    await reviewFinding('auth|1', 'f1', 'approved')

    const [url, init] = lastCall(fetchMock)
    expect(url).toContain('/findings/f1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ review_state: 'approved' })
  })

  it('hits clip URLs with the right methods', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ clips: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await listClips('auth|1', 'job-1')
    expect(lastCall(fetchMock)[0]).toBe(
      'http://localhost:3000/api/auth/user/auth%7C1/analyses/job-1/clips',
    )

    fetchMock.mockImplementation(() => jsonResponse({ clip: {} }))
    await createClip('auth|1', 'job-1', { label: 'L', start_ms: 0, end_ms: 100 })
    const [, postInit] = lastCall(fetchMock)
    expect(postInit.method).toBe('POST')

    fetchMock.mockImplementation(() => jsonResponse({ deleted: true }))
    await deleteClip('auth|1', 'job-1', 'c1')
    const [delUrl, delInit] = lastCall(fetchMock)
    expect(delUrl).toContain('/clips/c1')
    expect(delInit.method).toBe('DELETE')
  })

  it('cancels and renames analyses', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ cancelled: true }))
    vi.stubGlobal('fetch', fetchMock)

    await cancelAnalysis('auth|1', 'job-1')
    const [cancelUrl, cancelInit] = lastCall(fetchMock)
    expect(cancelUrl).toContain('/analyses/job-1/cancel')
    expect(cancelInit.method).toBe('POST')

    fetchMock.mockImplementation(() => jsonResponse({ analysis: {} }))
    await renameAnalysis('auth|1', 'job-1', 'New name')
    const [, patchInit] = lastCall(fetchMock)
    expect(patchInit.method).toBe('PATCH')
    expect(JSON.parse(patchInit.body as string)).toEqual({ display_name: 'New name' })
  })
})

describe('user facade', () => {
  it('syncs the user record', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ user: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await syncUser({ sub: 'auth|1', email: 'a@b.c' })

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/auth/sync')
    expect(init.method).toBe('POST')
  })

  it('reads the profile by auth0 id', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ user: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await getUserProfile('auth|1')

    const [url] = lastCall(fetchMock)
    expect(url).toBe('http://localhost:3000/api/auth/user/auth%7C1')
  })
})
