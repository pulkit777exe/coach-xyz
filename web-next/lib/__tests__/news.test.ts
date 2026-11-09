import { describe, expect, it } from 'vitest'

import {
  NEWS_FEEDS,
  coachAngle,
  fetchNews,
  formatNewsTime,
  normalizeNewsSport,
  parseFeed,
  stripHtml,
  type NewsFeed,
} from '../news'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example sport</title>
    <item>
      <title><![CDATA[Arsenal &amp; the press]]></title>
      <link>https://example.com/story-a?utm=1&amp;ref=rss</link>
      <description><![CDATA[<p>Hello <b>world</b> &amp; more.</p>]]></description>
      <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
      <media:content url="https://img.example.com/a.jpg" />
    </item>
    <item>
      <title>Late winner settles it</title>
      <link>https://example.com/story-b</link>
      <description>No image here.</description>
      <pubDate>Sun, 01 Nov 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Not a link</title>
      <guid>urn:example:not-a-url</guid>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom story</title>
    <link rel="alternate" href="https://example.com/atom-story" />
    <summary>A summary.</summary>
    <updated>2026-11-02T11:00:00Z</updated>
  </entry>
</feed>`

const FEED: NewsFeed = {
  id: 'test-feed',
  name: 'Test Sport',
  sport: 'tennis',
  url: 'https://example.com/rss',
  homepage: 'https://example.com',
}

describe('parseFeed', () => {
  it('reads RSS items, strips markup and decodes entities', () => {
    const items = parseFeed(RSS, FEED)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Arsenal & the press')
    expect(items[0].description).toBe('Hello world & more.')
    expect(items[0].link).toBe('https://example.com/story-a?utm=1&ref=rss')
    expect(items[0].publishedAt).toBe('2026-11-02T10:00:00.000Z')
    expect(items[0].imageUrl).toBe('https://img.example.com/a.jpg')
    expect(items[0].source).toBe('Test Sport')
    expect(items[0].sport).toBe('tennis')
    expect(items[0].coachAngle).toContain('constrained practice')
  })

  it('drops entries without a usable http(s) link', () => {
    expect(parseFeed(RSS, FEED).map((item) => item.title)).not.toContain('Not a link')
  })

  it('supports Atom entries', () => {
    const [item] = parseFeed(ATOM, FEED)
    expect(item.title).toBe('Atom story')
    expect(item.link).toBe('https://example.com/atom-story')
    expect(item.description).toBe('A summary.')
    expect(item.publishedAt).toBe('2026-11-02T11:00:00.000Z')
  })

  it('respects the per-feed limit', () => {
    expect(parseFeed(RSS, FEED, 1)).toHaveLength(1)
  })
})

describe('stripHtml', () => {
  it('removes scripts, tags and extra whitespace', () => {
    expect(stripHtml('<script>alert(1)</script><p> A &amp; B </p>')).toBe('A & B')
  })

  it('leaves an out-of-range numeric entity as text instead of throwing', () => {
    expect(stripHtml('A &#x110000; B')).toBe('A &#x110000; B')
  })
})

describe('coachAngle', () => {
  it('uses a keyword signal when the headline has one', () => {
    expect(coachAngle('Star ruled out with injury', 'football')).toContain('Load management')
    expect(coachAngle('Club record broken in final', 'football')).toContain('process target')
  })

  it('falls back to a sport-specific cue without inventing article detail', () => {
    const angle = coachAngle('A quiet off-season', 'basketball')
    expect(angle).toContain('closeout')
    expect(angle).not.toContain('off-season')
  })
})

describe('normalizeNewsSport', () => {
  it('accepts known tabs and degrades unknown input to all', () => {
    expect(normalizeNewsSport('football')).toBe('football')
    expect(normalizeNewsSport('FOOTBALL')).toBe('football')
    expect(normalizeNewsSport('curling')).toBe('all')
    expect(normalizeNewsSport(['tennis', 'football'])).toBe('tennis')
    expect(normalizeNewsSport(undefined)).toBe('all')
  })
})

describe('formatNewsTime', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')

  it('uses relative units for recent stories', () => {
    expect(formatNewsTime('2026-11-02T11:55:00Z', now)).toBe('5 minutes ago')
    expect(formatNewsTime('2026-11-02T10:00:00Z', now)).toBe('2 hours ago')
    expect(formatNewsTime('2026-10-30T12:00:00Z', now)).toBe('3 days ago')
  })

  it('falls back for missing or old dates', () => {
    expect(formatNewsTime(null, now)).toBe('Recent')
    expect(formatNewsTime('not-a-date', now)).toBe('Recent')
    expect(formatNewsTime('2026-09-01T12:00:00Z', now)).not.toContain('ago')
  })
})

describe('fetchNews', () => {
  it('keeps successful feeds, reports failures and de-duplicates stories', async () => {
    const duplicate = RSS
    const second = `<rss><channel><item><title>Second source story</title>
      <link>https://example.com/third</link><pubDate>Mon, 02 Nov 2026 12:00:00 GMT</pubDate>
      </item></channel></rss>`
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('feeds.bbci.co.uk/sport/football')) return new Response(duplicate, { status: 200 })
      if (url.includes('skysports.com/rss/12040')) return new Response(duplicate, { status: 200 })
      if (url.includes('espn.com/espn/rss/soccer')) return new Response(second, { status: 200 })
      throw new Error('network down')
    }) as typeof fetch

    const bundle = await fetchNews('football', { fetchImpl, limitPerFeed: 10 })
    expect(bundle.failures).toHaveLength(1)
    expect(bundle.failures[0].source).toBe('The Guardian')
    expect(bundle.articles.map((article) => article.link)).toEqual([
      'https://example.com/third',
      'https://example.com/story-a?utm=1&ref=rss',
      'https://example.com/story-b',
    ])
    expect(bundle.articles.length).toBeLessThanOrEqual(3)
  })

  it('has a feed for every non-all sport tab', () => {
    const covered = new Set(NEWS_FEEDS.map((feed) => feed.sport))
    expect(covered).toEqual(
      new Set(['football', 'basketball', 'cricket', 'tennis', 'baseball', 'hockey']),
    )
  })
})
