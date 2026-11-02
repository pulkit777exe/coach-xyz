import { formatDateShort } from './date'

// ── Newsroom data layer ───────────────────────────────────────────────────────
// A free, key-less RSS aggregation for the dashboard. The parser is deliberately
// small and dependency-free: feeds are ordinary RSS 2.0 (with an Atom fallback),
// and the page only needs title, link, summary, date, image and source. Anything
// the feed does not provide stays null rather than being filled in from another
// article or guessed.
//
// "Coach's angle" is deterministic and derived from the HEADLINE only. It is
// labelled that way in the UI: the feed does not give us the article body, so
// claiming the insight came from the full story would be invented provenance.

export const NEWS_SPORTS = [
  'all',
  'football',
  'basketball',
  'cricket',
  'tennis',
  'baseball',
  'hockey',
] as const

export type NewsSport = (typeof NEWS_SPORTS)[number]
export type NewsFeedSport = Exclude<NewsSport, 'all'>

export const NEWS_SPORT_LABEL: Record<NewsSport, string> = {
  all: 'Top stories',
  football: 'Football',
  basketball: 'Basketball',
  cricket: 'Cricket',
  tennis: 'Tennis',
  baseball: 'Baseball',
  hockey: 'Hockey',
}

export type NewsFeed = {
  id: string
  name: string
  sport: NewsFeedSport
  url: string
  homepage: string
}

/**
 * Public RSS feeds only. BBC, ESPN, Sky Sports and The Guardian all publish
 * without an API key; FotMob does not publish a public RSS feed, so it is not
 * faked here.
 */
export const NEWS_FEEDS: NewsFeed[] = [
  {
    id: 'bbc-football',
    name: 'BBC Sport',
    sport: 'football',
    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    homepage: 'https://www.bbc.co.uk/sport/football',
  },
  {
    id: 'sky-football',
    name: 'Sky Sports',
    sport: 'football',
    url: 'https://www.skysports.com/rss/12040',
    homepage: 'https://www.skysports.com/football',
  },
  {
    id: 'espn-soccer',
    name: 'ESPN',
    sport: 'football',
    url: 'https://www.espn.com/espn/rss/soccer/news',
    homepage: 'https://www.espn.com/soccer/',
  },
  {
    id: 'guardian-football',
    name: 'The Guardian',
    sport: 'football',
    url: 'https://www.theguardian.com/football/rss',
    homepage: 'https://www.theguardian.com/football',
  },
  {
    id: 'bbc-basketball',
    name: 'BBC Sport',
    sport: 'basketball',
    url: 'https://feeds.bbci.co.uk/sport/basketball/rss.xml',
    homepage: 'https://www.bbc.co.uk/sport/basketball',
  },
  {
    id: 'espn-nba',
    name: 'ESPN',
    sport: 'basketball',
    url: 'https://www.espn.com/espn/rss/nba/news',
    homepage: 'https://www.espn.com/nba/',
  },
  {
    id: 'bbc-cricket',
    name: 'BBC Sport',
    sport: 'cricket',
    url: 'https://feeds.bbci.co.uk/sport/cricket/rss.xml',
    homepage: 'https://www.bbc.co.uk/sport/cricket',
  },
  {
    id: 'bbc-tennis',
    name: 'BBC Sport',
    sport: 'tennis',
    url: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml',
    homepage: 'https://www.bbc.co.uk/sport/tennis',
  },
  {
    id: 'espn-mlb',
    name: 'ESPN',
    sport: 'baseball',
    url: 'https://www.espn.com/espn/rss/mlb/news',
    homepage: 'https://www.espn.com/mlb/',
  },
  {
    id: 'espn-nhl',
    name: 'ESPN',
    sport: 'hockey',
    url: 'https://www.espn.com/espn/rss/nhl/news',
    homepage: 'https://www.espn.com/nhl/',
  },
]

export type NewsArticle = {
  id: string
  title: string
  link: string
  description: string
  publishedAt: string | null
  sourceId: string
  source: string
  sport: NewsFeedSport
  imageUrl: string | null
  coachAngle: string
}

export type NewsFeedFailure = {
  sourceId: string
  source: string
  message: string
}

export type NewsBundle = {
  articles: NewsArticle[]
  failures: NewsFeedFailure[]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const hex = code[1]?.toLowerCase() === 'x'
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

export function stripHtml(input: string): string {
  return decodeEntities(
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tagText(block: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<${escapeRegExp(name)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(name)}>`,
      'i',
    )
    const found = pattern.exec(block)
    if (found?.[1]) {
      const text = stripHtml(found[1])
      if (text) return text
    }
  }
  return null
}

function tagAttr(block: string, names: string[], attr: string): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<${escapeRegExp(name)}\\b[^>]*\\b${escapeRegExp(attr)}=["']([^"']+)["']`,
      'i',
    )
    const found = pattern.exec(block)
    if (found?.[1]) return decodeEntities(found[1]).trim()
  }
  return null
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function imageFrom(block: string, description: string): string | null {
  const media = safeHttpUrl(tagAttr(block, ['media:content', 'media:thumbnail'], 'url'))
  if (media) return media

  const enclosure = tagAttr(block, ['enclosure'], 'url')
  const enclosureType = tagAttr(block, ['enclosure'], 'type') ?? ''
  if (enclosure && enclosureType.startsWith('image/')) {
    const safe = safeHttpUrl(enclosure)
    if (safe) return safe
  }

  const img = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(block) ?? /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(description)
  return safeHttpUrl(img ? decodeEntities(img[1]) : null)
}

function articleLink(block: string): string | null {
  const text = tagText(block, ['link', 'guid'])
  if (text) {
    const safe = safeHttpUrl(text)
    if (safe) return safe
  }
  const href = tagAttr(block, ['link'], 'href')
  return safeHttpUrl(href)
}

function publishedAt(block: string): string | null {
  const raw = tagText(block, ['pubDate', 'published', 'updated', 'dc:date'])
  if (!raw) return null
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function articleId(link: string, title: string): string {
  return link || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Parse an RSS 2.0 feed, falling back to Atom `<entry>` blocks. Exported so the
 * parser can be tested without network access.
 */
export function parseFeed(xml: string, feed: NewsFeed, limit = 10): NewsArticle[] {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ]
  const articles: NewsArticle[] = []
  for (const match of blocks) {
    const block = match[1]
    const title = tagText(block, ['title'])
    const link = articleLink(block)
    if (!title || !link) continue
    const description = stripHtml(
      tagText(block, ['description', 'summary', 'content:encoded']) ?? '',
    ).slice(0, 320)
    articles.push({
      id: articleId(link, title),
      title,
      link,
      description,
      publishedAt: publishedAt(block),
      sourceId: feed.id,
      source: feed.name,
      sport: feed.sport,
      imageUrl: imageFrom(block, description),
      coachAngle: coachAngle(title, feed.sport),
    })
    if (articles.length >= limit) break
  }
  return articles
}

const COACH_SIGNALS: Array<{ pattern: RegExp; angle: string }> = [
  {
    pattern: /injur|fitness|rehab|return|ruled out|out for|sidelined/i,
    angle:
      'Load management is the session theme. Build the return in small blocks, keep the last set submaximal, and judge the response tomorrow rather than chasing a number today.',
  },
  {
    pattern: /transfer|signing|signs|contract|loan|move to|joins/i,
    angle:
      'A new environment is a role-clarity problem before it is a technique problem. Rehearse the two actions the new system asks for most, and review the clips with the role named.',
  },
  {
    pattern: /sack|sacked|manager|head coach|appointed|interim/i,
    angle:
      'Tactical change rewards players who can re-learn a cue quickly. Pick one automatic action and one read-and-react action, then pressure both in the same drill.',
  },
  {
    pattern: /record|milestone|history|historic|first since/i,
    angle:
      'Use the benchmark as a process target, not an outcome target. Define the repeatable behaviour behind it and track that behaviour for the next three sessions.',
  },
  {
    pattern: /comeback|late win|wins|won|beat|victory|edge|thriller/i,
    angle:
      'Winning under pressure is a rehearsable skill. Finish the next session with scoreboard pressure and a short clock, then review the decision before the execution.',
  },
  {
    pattern: /lose|lost|defeat|slump|struggl|collapse|blow/i,
    angle:
      'Response under adversity is the training target. Keep the next session success criteria small and process-based so one bad outcome does not change the whole plan.',
  },
  {
    pattern: /academy|debut|young|prospect|breakthrough|rising/i,
    angle:
      'Development windows reward repetition and recovery in equal measure. Keep the technical block short, add one competitive constraint, and protect the recovery day.',
  },
  {
    pattern: /tactic|formation|press|defen[cs]e|attack|style|system/i,
    angle:
      'Turn the tactical story into a constrained practice: one team shape, one trigger, one finish. Review whether the first action matched the trigger before judging the result.',
  },
  {
    pattern: /home|away|road|pit|court|stadium/i,
    angle:
      'Home/venue advantage factor in the training plan. Factor the extra crowd energy or travel fatigue into your session warm-up and rotation decisions.',
  },
  {
    pattern: /rest|recovery|back-to-back|load management|ndays off/i,
    angle:
      'Rest cycle dictates the training focus. Prioritize active recovery and mobility work the day after a back-to-back set, then reassess readiness.',
  },
  {
    pattern: /revenge|redemption|pursuit|reset|statement/i,
    angle:
      'Redemptive motivation shapes the game plan. Build the session around the narrative of correcting a prior mistake, then measure the response.',
  },
]

const SPORT_ANGLE: Record<NewsFeedSport, string> = {
  football:
    'Football session cue: rehearse the first touch under pressure, scan before receiving, then make the next decision before the defender recovers.',
  basketball:
    'Basketball session cue: catch, scan the closeout, and make the next decision before the defence recovers. Put it under a short clock.',
  cricket:
    'Cricket session cue: take it to the nets as a scenario — score off the first ball from each bowler, then review shot selection rather than the outcome alone.',
  tennis:
    'Tennis session cue: build the point pattern around the story — serve to the weaker side, then attack the first short ball.',
  baseball:
    'Baseball session cue: hunt one pitch in one zone, and carry the same swing decision from the cage into live BP.',
  hockey:
    'Hockey session cue: rehearse the entry and shot under pressure — one touch to space, then a shot through the first lane.',
}

/**
 * A deterministic training prompt derived from the headline. It is intentionally
 * not an article summary: the feed does not include the body, so the UI labels
 * this as "from the headline".
 */
export function coachAngle(title: string, sport: NewsFeedSport): string {
  const signal = COACH_SIGNALS.find((entry) => entry.pattern.test(title))
  return signal ? signal.angle : SPORT_ANGLE[sport]
}

export function normalizeNewsSport(value: string | string[] | null | undefined): NewsSport {
  const raw = Array.isArray(value) ? value[0] : value
  const key = (raw ?? '').toLowerCase()
  return (NEWS_SPORTS as readonly string[]).includes(key) ? (key as NewsSport) : 'all'
}

function dedupeKey(article: NewsArticle): string {
  const title = article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return `${article.link}|${title}`
}

/** Fetch the feeds for one tab. Network failures are returned, never thrown. */
export async function fetchNews(
  sport: NewsSport = 'all',
  options: { fetchImpl?: typeof fetch; limitPerFeed?: number; now?: Date } = {},
): Promise<NewsBundle> {
  const fetchImpl = options.fetchImpl ?? fetch
  const limitPerFeed = options.limitPerFeed ?? 10
  const feeds = sport === 'all' ? NEWS_FEEDS : NEWS_FEEDS.filter((feed) => feed.sport === sport)
  const settled = await Promise.allSettled(
    feeds.map(async (feed) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 7000)
      try {
        const init: RequestInit & { next?: { revalidate: number } } = {
          headers: {
            accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            'user-agent': 'CoachXYZ newsroom (RSS reader)',
          },
          signal: controller.signal,
          next: { revalidate: 900 },
        }
        const response = await fetchImpl(feed.url, init)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return parseFeed(await response.text(), feed, limitPerFeed)
      } finally {
        clearTimeout(timer)
      }
    }),
  )

  const failures: NewsFeedFailure[] = []
  const byKey = new Map<string, NewsArticle>()
  settled.forEach((result, index) => {
    const feed = feeds[index]
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : 'feed unavailable'
      failures.push({ sourceId: feed.id, source: feed.name, message: reason })
      return
    }
    for (const article of result.value) {
      const key = dedupeKey(article)
      if (!byKey.has(key)) byKey.set(key, article)
    }
  })

  const articles = [...byKey.values()].sort((a, b) => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0
    return bt - at
  })
  return { articles, failures }
}

/**
 * "12 min ago", "3 hr ago", "2 days ago", then a calendar date for older items.
 * Pure arithmetic plus Intl.RelativeTimeFormat, so it does not create another
 * date-formatting path around `lib/date.ts`.
 */
export function formatNewsTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Recent'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return 'Recent'
  const diff = then - now
  const minutes = Math.round(diff / 60_000)
  if (Math.abs(minutes) < 1) return 'Just now'
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return formatter.format(days, 'day')
  return formatDateShort(iso)
}
