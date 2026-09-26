import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import {
  DEFAULT_EVENTS,
  isEventEnabled,
  type NotificationEvents,
} from '../src/lib/notificationPrefs'
import {
  DIGEST_CONCURRENCY,
  DIGEST_DISPLAY_LIMIT,
  buildDigestEmail,
  markDigestSent,
  notificationsForDigest,
  registerNotificationDigestJobs,
  runNotificationDigests,
  usersDueForDigest,
  type DigestCadence,
  type DigestEntry,
} from '../src/lib/notificationDigest'

// ── Notification digest ───────────────────────────────────────────────────────
// Hermetic: the store is stubbed through the documented test seam and Resend is
// stubbed at `fetch` (the only egress sendEmail makes), so these cases never
// depend on DATABASE_URL, Redis, or a real RESEND_API_KEY.

type StoredPrefs = {
  cadence: string
  events: NotificationEvents
  lastDigestAt: string | null
}

type StoredNotification = {
  auth0_id: string
  type: string
  title: string
  body: string | null
  /** jsonb as the driver hands it back: an object, or the serialized string. */
  data: unknown
  created_at: string
}

type StubState = {
  prefs: Map<string, StoredPrefs>
  notifications: StoredNotification[]
  emails: Map<string, string>
  stamps: Array<{ auth0_id: string; at: string }>
  /** Simulates a concurrent settings write between the due query and the
   *  per-account read: the account is handed to the batch, then flips. */
  flipCadenceAfterDueQuery: string | null
}

const allEvents = (): NotificationEvents =>
  Object.fromEntries(
    Object.keys(DEFAULT_EVENTS).map((event) => [event, true]),
  ) as NotificationEvents

const makeStubConnection = (state: StubState): SQL => {
  let nextId = 0
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()

    // usersDueForDigest: cadence match + exists(newer than the coalesced window)
    if (query.includes('from notification_preferences') && query.includes('coalesce')) {
      const [cadence, lookback] = values as [string, string]
      const due = [...state.prefs.entries()]
        .filter(([, prefs]) => prefs.cadence === cadence)
        .filter(([auth0Id, prefs]) =>
          state.notifications.some(
            (n) => n.auth0_id === auth0Id && n.created_at > (prefs.lastDigestAt ?? lookback),
          ),
        )
        .map(([auth0_id]) => ({ auth0_id }))

      if (state.flipCadenceAfterDueQuery) {
        const target = state.prefs.get(state.flipCadenceAfterDueQuery)
        if (target) target.cadence = 'instant'
        state.flipCadenceAfterDueQuery = null
      }
      return due
    }

    // notificationPrefs: one account's row.
    if (query.includes('from notification_preferences')) {
      const prefs = state.prefs.get(values[0] as string)
      if (!prefs) return []
      return [
        {
          in_app: true,
          cadence: prefs.cadence,
          events: { ...prefs.events },
          updated_at: '2026-09-25T00:00:00.000Z',
          last_digest_at: prefs.lastDigestAt,
        },
      ]
    }

    // notificationsForDigest
    if (query.includes('from notifications')) {
      const [auth0Id, since, limit] = values as [string, string, number]
      return state.notifications
        .filter((n) => n.auth0_id === auth0Id && n.created_at > since)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((n) => ({
          id: `notification-${++nextId}`,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data,
          created_at: n.created_at,
        }))
    }

    // markDigestSent
    if (query.includes('set last_digest_at')) {
      const [at, auth0Id] = values as [string, string]
      state.stamps.push({ auth0_id: auth0Id, at })
      const prefs = state.prefs.get(auth0Id)
      if (prefs) prefs.lastDigestAt = at
      return []
    }

    // getUserByAuth0Id
    if (query.includes('from users')) {
      const auth0Id = values[0] as string
      const email = state.emails.get(auth0Id)
      if (!email) return []
      return [
        {
          id: `user-${auth0Id}`,
          auth0_id: auth0Id,
          email,
          name: 'Casey Coach',
          nickname: null,
          picture: null,
          email_verified: true,
          linked_auth0_ids: [],
          role: 'coach',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ]
    }

    return []
  }) as unknown as SQL

  return Object.assign(tag, {
    connect: async () => {},
    unsafe: () => '',
    close: async () => {},
  }) as SQL
}

let restoreConnection: (() => void) | null = null

const useStub = (): StubState => {
  const state: StubState = {
    prefs: new Map(),
    notifications: [],
    emails: new Map(),
    stamps: [],
    flipCadenceAfterDueQuery: null,
  }
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

const setEmailConfigured = (configured: boolean) => {
  if (configured) {
    process.env.RESEND_API_KEY = 're_test_key'
  } else {
    delete (process.env as Record<string, string | undefined>).RESEND_API_KEY
  }
}

const realFetch = globalThis.fetch
let sentBodies: Array<{ to: string; subject: string; html: string; text: string }> = []
let failFor: Set<string> = new Set()

const stubFetch = () => {
  sentBodies = []
  globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      to: string[]
      subject: string
      html: string
      text: string
    }
    const to = body.to[0] ?? ''
    if (failFor.has(to)) {
      return new Response(JSON.stringify({ message: 'Resend said no' }), { status: 500 })
    }
    sentBodies.push({ to, subject: body.subject, html: body.html, text: body.text })
    return new Response(JSON.stringify({ id: `resend-${sentBodies.length}` }), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
  globalThis.fetch = realFetch
  failFor = new Set()
  setEmailConfigured(false)
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-26T07:00:00.000Z')

const entry = (overrides: Partial<DigestEntry> & { createdAt: string }): DigestEntry => ({
  id: 'n-1',
  type: 'analysis_complete',
  title: 'Analysis complete',
  body: null,
  href: null,
  ...overrides,
})

const seedPrefs = (state: StubState, auth0Id: string, prefs: Partial<StoredPrefs> = {}) => {
  state.prefs.set(auth0Id, {
    cadence: 'daily',
    events: allEvents(),
    lastDigestAt: null,
    ...prefs,
  })
}

// ── Pure template ─────────────────────────────────────────────────────────────

describe('buildDigestEmail', () => {
  test('groups entries by day with a heading per day', () => {
    const { subject, html, text } = buildDigestEmail({
      cadence: 'daily',
      appUrl: 'https://app.example.com',
      entries: [
        entry({ id: 'a', title: 'Report ready', createdAt: '2026-09-26T09:30:00.000Z' }),
        entry({ id: 'b', title: 'Attendance recorded', createdAt: '2026-09-26T08:00:00.000Z' }),
        entry({ id: 'c', title: 'Analysis failed', createdAt: '2026-09-25T18:00:00.000Z' }),
      ],
    })

    expect(subject).toBe('Your CoachXYZ daily digest: 3 new updates')
    expect(html).toContain('Sep 26')
    expect(html).toContain('Sep 25')
    // The two same-day entries share one heading, so the date appears once.
    expect(html.match(/Sep 26/g)).toHaveLength(1)
    expect(text).toContain('Sep 26')
    expect(text).toContain('Report ready')
    expect(text).toContain('- Analysis failed')
  })

  test('links an entry when the row carries a usable href and omits the link otherwise', () => {
    const { html, text } = buildDigestEmail({
      cadence: 'daily',
      appUrl: 'https://app.example.com',
      entries: [
        entry({ id: 'a', title: 'Analysis complete', createdAt: '2026-09-26T09:30:00.000Z' }),
        entry({ id: 'b', title: 'No link here', createdAt: '2026-09-26T08:00:00.000Z' }),
        entry({ id: 'c', title: 'Unsafe href', createdAt: '2026-09-26T07:00:00.000Z' }),
      ].map((e) =>
        e.id === 'a'
          ? { ...e, href: '/dashboard/analysis/job-1' }
          : e.id === 'c'
            ? { ...e, href: 'javascript:alert(1)' }
            : e,
      ) as DigestEntry[],
    })

    expect(html).toContain('https://app.example.com/dashboard/analysis/job-1')
    expect(html).not.toContain('javascript:alert(1)')
    expect(text).toContain('https://app.example.com/dashboard/analysis/job-1')
    // "No link here" has no href: it renders without any link markup.
    const noLinkRow = html.split('No link here')[1] ?? ''
    expect(noLinkRow.slice(0, 200)).not.toContain('<a ')
  })

  test('keeps an already-absolute href absolute', () => {
    const { html } = buildDigestEmail({
      cadence: 'weekly',
      appUrl: 'https://app.example.com',
      entries: [entry({ createdAt: '2026-09-26T09:30:00.000Z', href: 'https://other.test/x' })],
    })

    expect(html).toContain('https://other.test/x')
  })

  test('caps the list and adds a +N more line for the overflow', () => {
    const entries = Array.from({ length: DIGEST_DISPLAY_LIMIT + 7 }, (_, index) =>
      entry({
        id: `n-${index}`,
        title: `Update ${index}`,
        createdAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      }),
    )

    const { subject, html, text } = buildDigestEmail({
      cadence: 'daily',
      appUrl: 'https://app.example.com',
      entries,
    })

    expect(html).toContain('+7 more updates not shown')
    expect(text).toContain('+7 more updates not shown')
    // Exactly the cap is rendered; the overflow entries are counted, not listed.
    expect(html).toContain(`Update ${DIGEST_DISPLAY_LIMIT - 1}`)
    expect(html).not.toContain(`Update ${DIGEST_DISPLAY_LIMIT}`)
    expect(subject).toContain(`${entries.length} new updates`)
  })

  test('a zero-entry digest produces its own subject and body, never an empty email', () => {
    const { subject, html, text } = buildDigestEmail({ cadence: 'weekly', entries: [] })

    expect(subject).toBe('Your CoachXYZ weekly digest')
    expect(html).toContain('Nothing new since your last digest.')
    expect(text).toContain('nothing new since your last digest')
    // Distinct from the populated subject — a reader can tell them apart.
    const populated = buildDigestEmail({
      cadence: 'weekly',
      entries: [entry({ createdAt: NOW.toISOString() })],
    })
    expect(populated.subject).not.toBe(subject)
  })

  test('a single entry is counted in the singular', () => {
    const { subject, html } = buildDigestEmail({
      cadence: 'daily',
      entries: [entry({ createdAt: NOW.toISOString() })],
    })

    expect(subject).toBe('Your CoachXYZ daily digest: 1 new update')
    expect(html).toContain('1 new update since your last daily digest.')
  })

  test('escapes notification content in the html part', () => {
    const { html } = buildDigestEmail({
      cadence: 'daily',
      entries: [
        entry({
          title: '<script>alert(1)</script>',
          body: 'Ampersand & "quotes"',
          createdAt: NOW.toISOString(),
        }),
      ],
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })
})

// ── Due accounts ──────────────────────────────────────────────────────────────

describe('usersDueForDigest', () => {
  test('returns only accounts whose stored cadence matches the batch', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|daily', { cadence: 'daily' })
    seedPrefs(state, 'auth0|weekly', { cadence: 'weekly' })
    seedPrefs(state, 'auth0|instant', { cadence: 'instant' })
    for (const id of ['auth0|daily', 'auth0|weekly', 'auth0|instant']) {
      state.notifications.push({
        auth0_id: id,
        type: 'analysis_complete',
        title: 'Analysis complete',
        body: null,
        data: {},
        created_at: '2026-09-26T06:00:00.000Z',
      })
    }

    expect(await usersDueForDigest('daily', NOW)).toEqual(['auth0|daily'])
    expect(await usersDueForDigest('weekly', NOW)).toEqual(['auth0|weekly'])
  })

  test('treats a NULL last_digest_at as the cadence lookback', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|daily-recent', { cadence: 'daily' })
    seedPrefs(state, 'auth0|daily-stale', { cadence: 'daily' })
    seedPrefs(state, 'auth0|weekly-recent', { cadence: 'weekly' })
    seedPrefs(state, 'auth0|weekly-stale', { cadence: 'weekly' })

    const push = (auth0_id: string, created_at: string) =>
      state.notifications.push({
        auth0_id,
        type: 'analysis_complete',
        title: 'Analysis complete',
        body: null,
        data: {},
        created_at,
      })

    // Daily window = 24h: 6h old is in, 30h old is out.
    push('auth0|daily-recent', '2026-09-26T01:00:00.000Z')
    push('auth0|daily-stale', '2026-09-25T01:00:00.000Z')
    // Weekly window = 7d: 3d old is in, 10d old is out.
    push('auth0|weekly-recent', '2026-09-23T00:00:00.000Z')
    push('auth0|weekly-stale', '2026-09-16T00:00:00.000Z')

    expect(await usersDueForDigest('daily', NOW)).toEqual(['auth0|daily-recent'])
    expect(await usersDueForDigest('weekly', NOW)).toEqual(['auth0|weekly-recent'])
  })

  test('excludes an account whose rows are all older than the last digest', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|caught-up', { lastDigestAt: '2026-09-26T06:00:00.000Z' })
    state.notifications.push({
      auth0_id: 'auth0|caught-up',
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: null,
      data: {},
      created_at: '2026-09-26T05:00:00.000Z',
    })

    expect(await usersDueForDigest('daily', NOW)).toEqual([])
  })

  test('excludes an account with no notifications at all', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|silent')

    expect(await usersDueForDigest('daily', NOW)).toEqual([])
  })
})

// ── Per-event opt-out, re-checked at send time ────────────────────────────────

describe('notificationsForDigest', () => {
  test('returns rows newest first and honours the cap', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|busy')

    for (const [index, hour] of [1, 2, 3].entries()) {
      state.notifications.push({
        auth0_id: 'auth0|busy',
        type: 'analysis_complete',
        title: `Analysis ${index}`,
        body: null,
        data: {},
        created_at: new Date(Date.UTC(2026, 8, 26, hour)).toISOString(),
      })
    }

    const rows = await notificationsForDigest('auth0|busy', new Date('2026-09-26T00:00:00.000Z'), 2)

    expect(rows.map((row) => row.title)).toEqual(['Analysis 2', 'Analysis 1'])
  })

  test('re-checks the current per-event opt-out, so a row muted after creation is dropped', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|muted', {
      events: { ...allEvents(), report_ready: false },
    })
    state.notifications.push({
      auth0_id: 'auth0|muted',
      type: 'report_ready',
      title: 'Report ready',
      body: null,
      data: {},
      created_at: '2026-09-26T06:00:00.000Z',
    })
    state.notifications.push({
      auth0_id: 'auth0|muted',
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: null,
      data: {},
      created_at: '2026-09-26T05:00:00.000Z',
    })

    const rows = await notificationsForDigest('auth0|muted', new Date('2026-09-25T00:00:00.000Z'))

    expect(rows.map((row) => row.type)).toEqual(['analysis_complete'])
  })

  test('the in-app master switch does not gate the email channel', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|inapp-off')
    state.notifications.push({
      auth0_id: 'auth0|inapp-off',
      type: 'attendance',
      title: 'Attendance recorded',
      body: null,
      data: {},
      created_at: '2026-09-26T06:00:00.000Z',
    })
    // The stub row reports in_app = true, which is what isEventEnabled reads;
    // the digest filter must never consult that flag either way.
    expect(await isEventEnabled('auth0|inapp-off', 'attendance')).toBe(true)

    const rows = await notificationsForDigest(
      'auth0|inapp-off',
      new Date('2026-09-25T00:00:00.000Z'),
    )
    expect(rows).toHaveLength(1)
  })

  test('an unknown event name stays included (only an explicit false suppresses)', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|future')
    state.notifications.push({
      auth0_id: 'auth0|future',
      type: 'future_event_type',
      title: 'Something new',
      body: null,
      data: {},
      created_at: '2026-09-26T06:00:00.000Z',
    })

    const rows = await notificationsForDigest('auth0|future', new Date('2026-09-25T00:00:00.000Z'))
    expect(rows).toHaveLength(1)
  })

  test('a serialized jsonb `data` column still yields the href', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|hrefs')
    state.notifications.push({
      auth0_id: 'auth0|hrefs',
      type: 'report_ready',
      title: 'Report ready',
      body: null,
      data: { href: '/dashboard/reports/r-1' },
      created_at: '2026-09-26T06:00:00.000Z',
    })
    state.notifications.push({
      auth0_id: 'auth0|hrefs',
      type: 'ai_report',
      title: 'AI report ready',
      body: null,
      data: JSON.stringify({ href: '/dashboard/reports' }),
      created_at: '2026-09-26T05:00:00.000Z',
    })
    state.notifications.push({
      auth0_id: 'auth0|hrefs',
      type: 'membership',
      title: 'Membership changed',
      body: null,
      data: {},
      created_at: '2026-09-26T04:00:00.000Z',
    })

    const rows = await notificationsForDigest('auth0|hrefs', new Date('2026-09-25T00:00:00.000Z'))
    expect(rows.map((row) => row.href)).toEqual([
      '/dashboard/reports/r-1',
      '/dashboard/reports',
      null,
    ])
  })
})

// ── Runner ────────────────────────────────────────────────────────────────────

describe('runNotificationDigests', () => {
  const seedDue = (state: StubState, auth0Id: string, prefs: Partial<StoredPrefs> = {}) => {
    seedPrefs(state, auth0Id, prefs)
    state.emails.set(auth0Id, `${auth0Id.split('|')[1]}@example.com`)
    state.notifications.push({
      auth0_id: auth0Id,
      type: 'analysis_complete',
      title: `Analysis for ${auth0Id}`,
      body: 'Jordan Reyes',
      data: { href: '/dashboard/analysis/job-1' },
      created_at: '2026-09-26T06:00:00.000Z',
    })
  }

  test('no-ops cleanly when email is not configured', async () => {
    const state = useStub()
    setEmailConfigured(false)
    seedDue(state, 'auth0|no-email')
    stubFetch()

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary.emailConfigured).toBe(false)
    expect(summary.due).toBe(0)
    expect(summary.sent).toBe(0)
    expect(sentBodies).toEqual([])
    // No stamp either: an unconfigured run must not advance the window and
    // silently swallow the account's digest.
    expect(state.stamps).toEqual([])
  })

  test('sends one digest per due account and stamps the window on success', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|one')
    seedDue(state, 'auth0|two')
    stubFetch()

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary).toMatchObject({ due: 2, sent: 2, skipped: 0, failed: 0 })
    expect(sentBodies.map((body) => body.to).sort()).toEqual(['one@example.com', 'two@example.com'])
    // ONE message per account — never one per event.
    expect(sentBodies).toHaveLength(2)
    expect(sentBodies[0].subject).toBe('Your CoachXYZ daily digest: 1 new update')
    expect(state.stamps.map((stamp) => stamp.auth0_id).sort()).toEqual(['auth0|one', 'auth0|two'])
  })

  test('skips and logs one failed account without failing the batch', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|good')
    seedDue(state, 'auth0|bad')
    stubFetch()
    failFor = new Set(['bad@example.com'])

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary).toMatchObject({ due: 2, sent: 1, skipped: 0, failed: 1 })
    expect(sentBodies.map((body) => body.to)).toEqual(['good@example.com'])
    // Only the successful account advanced its window, so the failed one is
    // still due and will be re-offered on the next run.
    expect(state.stamps.map((stamp) => stamp.auth0_id)).toEqual(['auth0|good'])
    expect(state.prefs.get('auth0|bad')?.lastDigestAt).toBeNull()
  })

  test('a second run in the same window sends nothing', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|once')
    stubFetch()

    await runNotificationDigests('daily', NOW)
    const second = await runNotificationDigests('daily', NOW)

    expect(sentBodies).toHaveLength(1)
    expect(second).toMatchObject({ due: 0, sent: 0 })
  })

  test('skips an account with no deliverable email address', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|no-address')
    state.emails.set('auth0|no-address', 'not-an-email')
    stubFetch()

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: 1, failed: 0 })
    expect(sentBodies).toEqual([])
    expect(state.stamps).toEqual([])
  })

  test('skips an account whose cadence changed after the due query', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|switched')
    stubFetch()
    // The user opted out of digests after the due query handed the account to
    // this batch but before the per-account read.
    state.flipCadenceAfterDueQuery = 'auth0|switched'

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary).toMatchObject({ due: 1, sent: 0, skipped: 1, failed: 0 })
    expect(sentBodies).toEqual([])
    expect(state.stamps).toEqual([])
  })

  test('bounds the outbound burst to a handful of concurrent requests', async () => {
    const state = useStub()
    setEmailConfigured(true)
    for (let index = 0; index < DIGEST_CONCURRENCY * 3; index += 1) {
      seedDue(state, `auth0|batch-${index}`)
    }
    stubFetch()

    let inFlight = 0
    let peak = 0
    globalThis.fetch = (async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runNotificationDigests('daily', NOW)

    expect(summary.sent).toBe(DIGEST_CONCURRENCY * 3)
    expect(peak).toBeLessThanOrEqual(DIGEST_CONCURRENCY)
  })

  test('the weekly batch only sees weekly accounts', async () => {
    const state = useStub()
    setEmailConfigured(true)
    seedDue(state, 'auth0|weekly-user', { cadence: 'weekly' })
    seedDue(state, 'auth0|daily-user', { cadence: 'daily' })
    stubFetch()

    await runNotificationDigests('weekly', NOW)

    expect(sentBodies.map((body) => body.to)).toEqual(['weekly-user@example.com'])
    expect(sentBodies[0].subject).toContain('weekly')
  })
})

// ── markDigestSent ────────────────────────────────────────────────────────────

describe('markDigestSent', () => {
  test('stamps the supplied time, defaulting to now', async () => {
    const state = useStub()
    seedPrefs(state, 'auth0|stamped')

    await markDigestSent('auth0|stamped', NOW)
    expect(state.prefs.get('auth0|stamped')?.lastDigestAt).toBe(NOW.toISOString())

    const before = new Date()
    await markDigestSent('auth0|stamped')
    const stamped = state.prefs.get('auth0|stamped')?.lastDigestAt
    expect(stamped).not.toBeNull()
    expect(new Date(stamped as string).getTime()).toBeGreaterThanOrEqual(before.getTime())
  })
})

// ── Repeatable-job registration ───────────────────────────────────────────────

describe('registerNotificationDigestJobs', () => {
  test('registers one UTC cron repeatable per cadence', async () => {
    const calls: Array<{ id: string; pattern: string; tz: string; data: unknown }> = []

    await registerNotificationDigestJobs({
      upsertJobScheduler: async (id, repeatOpts, template) => {
        calls.push({
          id,
          pattern: repeatOpts.pattern,
          tz: repeatOpts.tz,
          data: template.data,
        })
        return {}
      },
    })

    expect(calls).toEqual([
      {
        id: 'notification-digest-daily',
        pattern: '0 7 * * *',
        tz: 'UTC',
        data: { cadence: 'daily' },
      },
      {
        id: 'notification-digest-weekly',
        pattern: '0 7 * * 1',
        tz: 'UTC',
        data: { cadence: 'weekly' },
      },
    ])
  })

  test('one cadence failing to register does not lose the other', async () => {
    const ids: string[] = []

    await registerNotificationDigestJobs({
      upsertJobScheduler: async (id) => {
        if (id === 'notification-digest-daily') throw new Error('redis blip')
        ids.push(id)
        return {}
      },
    })

    expect(ids).toEqual(['notification-digest-weekly'])
  })
})

// ── Cadence vocabulary ────────────────────────────────────────────────────────

describe('digest cadence type', () => {
  test('only the two emailing cadences are schedulable', () => {
    const cadences: DigestCadence[] = ['daily', 'weekly']
    expect(cadences).not.toContain('instant')
  })
})
