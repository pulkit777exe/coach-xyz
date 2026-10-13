import { describe, expect, it } from 'vitest'

import { scrubSentryBreadcrumb, scrubSentryEvent, scrubUrl } from '../sentryScrub'

describe('scrubUrl', () => {
  it('strips query strings and fragments, keeps the path', () => {
    expect(scrubUrl('https://app.example/api/download/j1?attribution=abc.def&x=1')).toBe(
      'https://app.example/api/download/j1',
    )
    expect(scrubUrl('https://app.example/share/tok#section')).toBe('https://app.example/share/tok')
    expect(scrubUrl('https://app.example/about')).toBe('https://app.example/about')
  })
})

describe('scrubSentryEvent', () => {
  it('scrubs request urls, breadcrumb urls, and transaction names', () => {
    const event = scrubSentryEvent({
      request: { url: 'https://app.example/api/download/j1?attribution=secret' },
      breadcrumbs: [
        { category: 'fetch', data: { url: 'https://app.example/api/me/x?token=t' } },
        { category: 'navigation', message: 'https://app.example/invite?token=t' },
      ],
      transaction: '/api/download/j1?attribution=secret',
    } as never)
    expect(event.request?.url).toBe('https://app.example/api/download/j1')
    expect(event.breadcrumbs?.[0]?.data?.url).toBe('https://app.example/api/me/x')
    expect(event.breadcrumbs?.[1]?.message).toBe('https://app.example/invite')
    expect(event.transaction).toBe('/api/download/j1')
  })
})

describe('scrubSentryBreadcrumb', () => {
  it('leaves non-url breadcrumbs untouched', () => {
    const crumb = { category: 'ui', message: 'button clicked' }
    expect(scrubSentryBreadcrumb(crumb)).toEqual(crumb)
  })
})
