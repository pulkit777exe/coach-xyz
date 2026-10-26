// Two defects with the same character: a response nobody inspected, and a lookup
// that consulted the prototype instead of the data.
//
// 1. `markRead` / `markAllRead` awaited the fetch and threw the status away. The
//    caller's UI has already decremented unreadCount and flipped the row to read
//    by the time the promise settles, and it swallows the rejection — so a 401 or
//    a 502 cleared the dot, told the user nothing, and the row came back unread
//    on the next snapshot. `mergeSnapshot` only floors the count, so the count
//    drifted with it. Neither function encoded its path id, either, unlike the
//    rest of the module.
//
// 2. `postsBySlug` was built with `Object.fromEntries`, so it inherited from
//    `Object.prototype` and `postsBySlug['toString']` was a function — truthy, so
//    the blog page's `if (!post) notFound()` did not fire and the render threw on
//    `post.body.map`. `dynamicParams` defaults to true, so `/blog/toString` was a
//    reachable 500 (and a Sentry event) for an unauthenticated visitor where the
//    answer is a 404.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { markAllRead, markRead } from '../notifications'
import { postsBySlug } from '../blog'

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('markRead reports a failed write instead of swallowing it', () => {
  it('resolves on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200)))
    await expect(markRead('n-1')).resolves.toBeUndefined()
  })

  it('throws on a 401 so the caller can put the dot back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'no session' }, 401)))
    await expect(markRead('n-1')).rejects.toMatchObject({ layer: 'server' })
  })

  it('throws on a 502 from the org proxy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 502)))
    await expect(markRead('n-1')).rejects.toBeDefined()
  })

  it('does not throw on a body that is not JSON', async () => {
    // A proxy error page is HTML; the mapping must survive it rather than
    // replacing a real failure with a parse error.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })),
    )
    await expect(markRead('n-1')).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
  })

  it('marks every notification as read only on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200)))
    await expect(markAllRead()).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    await expect(markAllRead()).rejects.toBeDefined()
  })

  it('encodes the notification id in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200))
    vi.stubGlobal('fetch', fetchMock)
    await markRead('a/b?c')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('a%2Fb%3Fc')
  })
})

describe('the blog slug index has no prototype to hit', () => {
  it('has a real post for every slug it lists', () => {
    expect(postsBySlug.size).toBeGreaterThan(0)
    for (const slug of postsBySlug.keys()) {
      expect(postsBySlug.get(slug)).toBeDefined()
    }
  })

  it.each([
    'toString',
    'constructor',
    'hasOwnProperty',
    'valueOf',
    '__proto__',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
  ])('returns undefined for the inherited key %s', (key) => {
    // The 500: these were all truthy, so `if (!post) notFound()` passed and the
    // next line dereferenced `body` on a function.
    expect(postsBySlug.get(key)).toBeUndefined()
  })

  it('a lookup miss is undefined rather than a thrown TypeError', () => {
    const missing = postsBySlug.get('no-such-post')
    expect(missing).toBeUndefined()
    // What the page does next, and what used to throw.
    expect(() => missing?.body.map((p: string) => p)).not.toThrow()
  })
})
