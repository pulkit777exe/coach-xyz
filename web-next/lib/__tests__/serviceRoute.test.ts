import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }))

vi.mock('@/lib/auth0', () => ({
  auth0: { getSession: getSessionMock },
}))

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/service/[[...path]]/route'

const BACKEND = 'http://localhost:3000'

const realFetch = globalThis.fetch
const realServiceToken = process.env.SERVICE_TOKEN

const backendJson = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const req = (
  path: string,
  init?: Omit<RequestInit, 'signal'> & { signal?: AbortSignal; nextUrlSearch?: string },
) => {
  const { nextUrlSearch, ...rest } = init ?? {}
  // The route only reads method, headers, nextUrl.search, and the body.
  return new NextRequest(`http://localhost${path}${nextUrlSearch ?? ''}`, rest)
}

const ctxFor = (path: string[]) => ({
  params: Promise.resolve({ path }),
})

beforeEach(() => {
  vi.unstubAllGlobals()
  getSessionMock.mockReset()
  process.env.SERVICE_TOKEN = 'test-service-token'
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (realServiceToken === undefined) delete process.env.SERVICE_TOKEN
  else process.env.SERVICE_TOKEN = realServiceToken
})

describe('identity proxy route', () => {
  it('injects service headers and forwards the client request id', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ analyses: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(
      req('/api/service/api/org/auth0|coach-1/analyses', {
        headers: { 'x-request-id': 'req-123' },
      }),
      ctxFor(['api', 'org', 'auth0|coach-1', 'analyses']),
    )

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BACKEND}/api/org/auth0|coach-1/analyses`)
    const headers = new Headers(init.headers)
    expect(headers.get('x-service-token')).toBe('test-service-token')
    expect(headers.get('x-verified-auth0-id')).toBe('auth0|coach-1')
    expect(headers.get('x-request-id')).toBe('req-123')
  })

  it('401s without a session, in the canonical shape', async () => {
    getSessionMock.mockResolvedValue(null)

    const res = await GET(
      req('/api/service/api/org/x/students'),
      ctxFor(['api', 'org', 'x', 'students']),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized.',
      layer: 'server',
      retryable: false,
    })
  })

  it('404s non-identity paths and traversal attempts', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })

    for (const path of [
      ['api', 'scan-video'],
      ['api', 'org', '..', 'x'],
    ]) {
      const res = await GET(req('/api/service/' + path.join('/')), ctxFor(path))
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  it('502s with BAD_GATEWAY when the backend is unreachable', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const res = await POST(
      req('/api/service/api/me/analyses', { method: 'POST' }),
      ctxFor(['api', 'me', 'analyses']),
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      code: 'BAD_GATEWAY',
      message: 'Backend service is temporarily unavailable.',
      layer: 'server',
      retryable: true,
    })
  })

  it('streams backend error bodies through untouched', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          backendJson(
            { code: 'RATE_LIMITED', message: 'Slow down', layer: 'server', retryable: true },
            429,
          ),
        ),
    )

    const res = await GET(
      req('/api/service/api/org/x/students'),
      ctxFor(['api', 'org', 'x', 'students']),
    )

    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('strips hop-by-hop headers from backend responses', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(backendJson({ ok: true }, 200, { connection: 'keep-alive' })),
    )

    const res = await DELETE(
      req('/api/service/api/org/x/students/s1', { method: 'DELETE' }),
      ctxFor(['api', 'org', 'x', 'students', 's1']),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('connection')).toBeNull()
  })

  it('exposes all five mutating verbs', async () => {
    getSessionMock.mockResolvedValue({ user: { sub: 'auth0|coach-1' } })
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    for (const [handler, method] of [
      [PUT, 'PUT'],
      [PATCH, 'PATCH'],
    ] as const) {
      const res = await handler(
        req('/api/service/api/org/x/students/s1', { method }),
        ctxFor(['api', 'org', 'x', 'students', 's1']),
      )
      expect(res.status).toBe(200)
    }
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
  })
})
