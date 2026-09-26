// ── Notification digest (email summaries) ─────────────────────────────────────
//
// Semantics, decided:
// - `cadence: 'instant'` is IN-APP ONLY. No digest email, ever.
// - `cadence: 'daily' | 'weekly'` sends ONE summary email of the rows the
//   account missed, on that cadence. There is deliberately no per-event
//   transactional email — one message per cadence, not one per event.
// - The in-app master switch (`inApp`) does NOT gate the email channel: the two
//   channels are independent. Per-EVENT opt-outs DO apply and are re-checked at
//   send time, so an event muted after the row was written is not emailed.
//
// The module owns both halves of the feature: the pure rendering half
// (buildDigestEmail — no I/O, unit-testable) and the data half (due-window
// queries, the bounded runner, the repeatable-job registration). lib/queue.ts
// builds the queue/worker and calls in from startQueueInfrastructure() under
// the same Redis gate as everything else, mirroring lib/retention.ts's
// "domain owns its schedule" split.

import { orDisabledDefault, withHistoryStore } from './historyStore'
import { digestEmail, emailConfigured, escapeHtml, isDeliverableAddress, sendEmail } from './mailer'
import { DEFAULT_EVENTS, notificationPrefs, type NotificationEvent } from './notificationPrefs'
import { getUserByAuth0Id } from './users'
import { logger } from './logger'

// ── Cadence + schedule ───────────────────────────────────────────────────────

/** The two cadences that produce an email. 'instant' is excluded by type. */
export type DigestCadence = 'daily' | 'weekly'

export const DIGEST_CADENCES: readonly DigestCadence[] = ['daily', 'weekly']

/**
 * Repeatable-job cron patterns, UTC. 07:00 UTC daily, and 07:00 UTC on Mondays
 * for the weekly. Both pass `tz: 'UTC'` to BullMQ so the schedule is anchored
 * to UTC regardless of the host's local zone.
 */
export const DIGEST_CRON: Readonly<Record<DigestCadence, string>> = Object.freeze({
  daily: '0 7 * * *',
  weekly: '0 7 * * 1',
})

export const DIGEST_SCHEDULER_IDS: Readonly<Record<DigestCadence, string>> = Object.freeze({
  daily: 'notification-digest-daily',
  weekly: 'notification-digest-weekly',
})

/** Entries rendered in one email. Beyond this a "+N more" line takes over. */
export const DIGEST_DISPLAY_LIMIT = 50

/** Rows read per account per run (a fetch bound, distinct from the cap). */
const DIGEST_FETCH_LIMIT = 200

/** Accounts per run — a bound on batch size, not a correctness limit. */
const DIGEST_DUE_LIMIT = 500

/** Accounts emailed at once. A handful, never a thundering herd. */
export const DIGEST_CONCURRENCY = 4

/**
 * How far back a FIRST digest looks. A NULL `last_digest_at` means "never
 * digested"; using the account's whole history as the first window would dump
 * every notification they ever received into one email.
 */
const FIRST_DIGEST_LOOKBACK_MS: Readonly<Record<DigestCadence, number>> = Object.freeze({
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
})

// ── Types ─────────────────────────────────────────────────────────────────────

export type DigestEntry = {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  /** ISO-8601, always. */
  createdAt: string
}

export type Digest = {
  cadence: DigestCadence
  entries: DigestEntry[]
  /**
   * Base for entry links. Defaults to the configured app URL. Separated from
   * the pure renderer so a test can pin it without touching process.env.
   */
  appUrl?: string
}

type DigestRow = {
  id: string
  type: string
  title: string
  body: string | null
  data: unknown
  created_at: string | Date
}

const toIso = (value: string | Date, fallback: Date): string => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString()
}

/** Digests link with an ABSOLUTE url; the stored href is a site-relative path. */
const absoluteUrl = (href: string | null | undefined, base: string): string | null => {
  const raw = typeof href === 'string' ? href.trim() : ''
  if (!raw) return null
  if (raw.startsWith('/')) return `${base}${raw}`
  if (/^https?:\/\//i.test(raw)) return raw
  // Anything else (a `javascript:` href, a bare path) is not a link we send.
  return null
}

const appBaseUrl = (appUrl?: string): string => {
  const configured = appUrl ?? process.env.APP_URL ?? 'http://localhost:3000'
  return configured.replace(/\/+$/, '')
}

/** Human label for the group a day-heading belongs to. */
const dayLabel = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const dayHeading = (day: string): string => {
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const groupByDay = (entries: DigestEntry[]): { day: string; entries: DigestEntry[] }[] => {
  const groups = new Map<string, DigestEntry[]>()
  for (const entry of entries) {
    const day = dayLabel(entry.createdAt)
    const bucket = groups.get(day)
    if (bucket) bucket.push(entry)
    else groups.set(day, [entry])
  }
  return [...groups.entries()].map(([day, dayEntries]) => ({ day, entries: dayEntries }))
}

// ── Pure rendering ───────────────────────────────────────────────────────────

/**
 * Render a digest email. Pure: no I/O, no clock read beyond the entry
 * timestamps, so the shape is trivially unit-testable.
 *
 * Entries are grouped by UTC day (newest first, as the data layer returns
 * them), each showing title, an optional body, and a link when the row carries
 * a usable `data.href`. The list is capped at DIGEST_DISPLAY_LIMIT with a
 * "+N more" line. A zero-entry digest gets its own subject and body — it must
 * never render as a blank email.
 */
export const buildDigestEmail = (
  digest: Digest,
): { subject: string; html: string; text: string } => {
  const { cadence, entries } = digest
  const base = appBaseUrl(digest.appUrl)
  const shown = entries.slice(0, DIGEST_DISPLAY_LIMIT)
  const overflow = entries.length - shown.length

  if (shown.length === 0) {
    const subject = `Your CoachXYZ ${cadence} digest`
    return digestEmail(
      subject,
      '<p>Nothing new since your last digest.</p>',
      '',
      `Your CoachXYZ ${cadence} digest: nothing new since your last digest.`,
    )
  }

  const subject = `Your CoachXYZ ${cadence} digest: ${entries.length} new update${
    entries.length === 1 ? '' : 's'
  }`

  const groups = groupByDay(shown)

  const groupsHtml = groups
    .map((group) => {
      const rows = group.entries
        .map((entry) => {
          const href = absoluteUrl(entry.href, base)
          const body = entry.body
            ? `<div style="font-size:13px;color:#7a6e62;margin-top:2px;">${escapeHtml(
                entry.body,
              )}</div>`
            : ''
          const link = href
            ? `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:6px;font-size:13px;font-weight:600;color:#433B34;">Open in CoachXYZ</a>`
            : ''
          return `<li style="padding:10px 0;border-bottom:1px solid #e8e0d5;">
            <div style="font-size:14px;font-weight:600;">${escapeHtml(entry.title)}</div>
            ${body}
            ${link}
          </li>`
        })
        .join('')

      return `<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#7a6e62;margin:20px 0 4px;">${escapeHtml(
        dayHeading(group.day),
      )}</h2>
        <ul style="list-style:none;margin:0;padding:0;">${rows}</ul>`
    })
    .join('')

  const overflowNote =
    overflow > 0
      ? `<p style="font-size:13px;color:#7a6e62;margin-top:14px;">+${overflow} more update${
          overflow === 1 ? '' : 's'
        } not shown. Open CoachXYZ to see everything.</p>`
      : ''

  const textLines = [
    subject,
    '',
    ...groups.flatMap((group) => [
      dayHeading(group.day),
      ...group.entries.map((entry) => {
        const href = absoluteUrl(entry.href, base)
        const body = entry.body ? ` — ${entry.body}` : ''
        return `- ${entry.title}${body}${href ? ` (${href})` : ''}`
      }),
      '',
    ]),
    ...(overflow > 0 ? [`+${overflow} more update${overflow === 1 ? '' : 's'} not shown.`] : []),
  ]

  return digestEmail(
    subject,
    `<p>${entries.length} new update${entries.length === 1 ? '' : 's'} since your last ${
      cadence
    } digest.</p>`,
    `${groupsHtml}${overflowNote}`,
    textLines.join('\n').trim(),
  )
}

// ── Data layer ────────────────────────────────────────────────────────────────

/**
 * Accounts whose cadence is this one AND who have at least one notification
 * newer than their `last_digest_at`. A NULL `last_digest_at` reads as the
 * cadence lookback (24h daily / 7d weekly) so a first digest covers one
 * period, not all history.
 *
 * The opt-out re-check happens in `notificationsForDigest`; this query is only
 * the cheap "is there anything at all" filter.
 */
export const usersDueForDigest = async (
  cadence: DigestCadence,
  now: Date = new Date(),
): Promise<string[]> => {
  const lookback = new Date(now.getTime() - FIRST_DIGEST_LOOKBACK_MS[cadence]).toISOString()

  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<{ auth0_id: string }[]>`
        select auth0_id
        from notification_preferences
        where cadence = ${cadence}
          and exists (
            select 1
            from notifications n
            where n.auth0_id = notification_preferences.auth0_id
              and n.created_at > coalesce(notification_preferences.last_digest_at, ${lookback}::timestamptz)
          )
        order by auth0_id
        limit ${DIGEST_DUE_LIMIT};
      `
      return (rows ?? []).map((row) => row.auth0_id)
    }),
    [],
  )
}

/**
 * The rows one account missed, newest first, capped.
 *
 * The per-event opt-out is re-read HERE, at send time, not at creation time: a
 * user who muted an event after the row was written must not receive it in the
 * digest. The in-app master switch is deliberately NOT applied — the channels
 * are independent. Unknown event names stay included (only an explicit stored
 * `false` suppresses), matching `isEventEnabled`'s fail-open rule.
 */
export const notificationsForDigest = async (
  auth0Id: string,
  since: Date,
  limit: number = DIGEST_FETCH_LIMIT,
): Promise<DigestEntry[]> => {
  const preferences = await notificationPrefs(auth0Id)
  // String-keyed on purpose: a stored row may carry an event name this build
  // doesn't know, and a `Set<NotificationEvent>` would reject the lookup.
  const muted = new Set<string>(
    (Object.keys(DEFAULT_EVENTS) as NotificationEvent[]).filter(
      (event) => preferences.events[event] === false,
    ),
  )

  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<DigestRow[]>`
        select id, type, title, body, data, created_at
        from notifications
        where auth0_id = ${auth0Id}
          and created_at > ${since.toISOString()}::timestamptz
        order by created_at desc
        limit ${limit};
      `

      const now = new Date()
      return (rows ?? [])
        .filter((row) => !muted.has(row.type))
        .map((row) => toDigestEntry(row, now))
    }),
    [],
  )
}

const toDigestEntry = (row: DigestRow, now: Date): DigestEntry => ({
  id: String(row.id),
  type: row.type,
  title: row.title,
  body: row.body ?? null,
  href: hrefFromData(row.data),
  createdAt: toIso(row.created_at, now),
})

/** `data` is jsonb, so it arrives as an object — but a driver may hand back
 *  the serialized string, and the same normalization notifications.ts applies
 *  to the live path applies here. */
const hrefFromData = (value: unknown): string | null => {
  let source: unknown = value
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return null
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const href = (source as Record<string, unknown>).href
  return typeof href === 'string' && href.trim() ? href.trim() : null
}

/**
 * Stamp the digest window. Called ONLY after a successful send, so a failed or
 * unconfigured send re-offers the same rows on the next run instead of
 * silently losing them.
 */
export const markDigestSent = async (auth0Id: string, at: Date = new Date()): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      update notification_preferences set last_digest_at = ${at.toISOString()}::timestamptz
      where auth0_id = ${auth0Id};
    `
  })
}

// ── Runner ────────────────────────────────────────────────────────────────────

export type DigestRunSummary = {
  cadence: DigestCadence
  /** Accounts found due. */
  due: number
  sent: number
  /** No recipient, or the cadence changed mid-run. */
  skipped: number
  failed: number
  /** False when RESEND_API_KEY is unset — the run is then a clean no-op. */
  emailConfigured: boolean
}

const sendOneDigest = async (
  auth0Id: string,
  cadence: DigestCadence,
  now: Date,
): Promise<'sent' | 'skipped' | 'failed'> => {
  try {
    const preferences = await notificationPrefs(auth0Id)
    // The cadence can change between the due query and the send.
    if (preferences.cadence !== cadence) return 'skipped'

    const user = await getUserByAuth0Id(auth0Id)
    const to = user?.email?.trim() ?? ''
    if (!isDeliverableAddress(to)) {
      logger.info('notification_digest_no_recipient', {
        type: 'notification_digest_no_recipient',
        auth0Id,
        cadence,
      })
      return 'skipped'
    }

    const since =
      preferences.lastDigestAt !== null
        ? new Date(preferences.lastDigestAt)
        : new Date(now.getTime() - FIRST_DIGEST_LOOKBACK_MS[cadence])
    const entries = await notificationsForDigest(auth0Id, since)

    const { subject, html, text } = buildDigestEmail({ cadence, entries })
    await sendEmail({ to, subject, html, text })
    // Stamped with the batch's clock, so `last_digest_at` reads as "the start
    // of the window just emailed" and consecutive runs tile the cadence
    // period exactly.
    await markDigestSent(auth0Id, now)
    return 'sent'
  } catch (error) {
    // One account's failure must not fail the batch: log, leave last_digest_at
    // untouched, keep going.
    logger.error('notification_digest_send_failed', {
      type: 'notification_digest_send_failed',
      auth0Id,
      cadence,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

/**
 * Send one digest per due account. Called by the repeatable jobs
 * (registerNotificationDigestJobs) and safe to call directly in tests.
 *
 * No-ops cleanly when email is not configured (RESEND_API_KEY unset): it
 * returns without throwing and without retry-spamming, so the repeatable job
 * completes rather than failing into BullMQ's retry ladder.
 */
export const runNotificationDigests = async (
  cadence: DigestCadence,
  now: Date = new Date(),
): Promise<DigestRunSummary> => {
  const summary: DigestRunSummary = {
    cadence,
    due: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    emailConfigured: emailConfigured(),
  }

  if (!summary.emailConfigured) {
    logger.info('notification_digest_email_unconfigured', {
      type: 'notification_digest_email_unconfigured',
      cadence,
    })
    return summary
  }

  const due = await usersDueForDigest(cadence, now)
  summary.due = due.length
  if (due.length === 0) {
    logger.info('notification_digest_noop', { type: 'notification_digest_noop', cadence })
    return summary
  }

  // Bounded concurrency: a fixed-size worker pool over the due list, so a big
  // batch never opens 500 concurrent Resend requests.
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < due.length) {
      const auth0Id = due[cursor++]
      if (auth0Id === undefined) return
      const outcome = await sendOneDigest(auth0Id, cadence, now)
      if (outcome === 'sent') summary.sent += 1
      else if (outcome === 'skipped') summary.skipped += 1
      else summary.failed += 1
    }
  }

  const pool = Math.min(DIGEST_CONCURRENCY, due.length)
  await Promise.all(Array.from({ length: pool }, worker))

  logger.info('notification_digest_run', {
    type: 'notification_digest_run',
    cadence,
    due: summary.due,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
  })
  return summary
}

// ── Repeatable-job registration ───────────────────────────────────────────────

/**
 * Register the two cron repeatables. Owned here (not in queue.ts) so the
 * cadence → schedule mapping lives beside the runner it calls; queue.ts supplies
 * the queue and owns the lifecycle.
 */
export const registerNotificationDigestJobs = async (queue: {
  upsertJobScheduler: (
    id: string,
    repeatOpts: { pattern: string; tz: string },
    template: { name: string; data: { cadence: DigestCadence } },
  ) => Promise<unknown>
}): Promise<void> => {
  for (const cadence of DIGEST_CADENCES) {
    try {
      await queue.upsertJobScheduler(
        DIGEST_SCHEDULER_IDS[cadence],
        { pattern: DIGEST_CRON[cadence], tz: 'UTC' },
        { name: 'notification-digest', data: { cadence } },
      )
    } catch (error) {
      // One cadence's registration failing must not lose the other, and must
      // not fail startup — the sweep simply doesn't run for that cadence.
      logger.error('notification_digest_schedule_error', {
        type: 'notification_digest_schedule_error',
        cadence,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logger.info('notification_digest_scheduled', {
    type: 'notification_digest_scheduled',
    cadences: DIGEST_CADENCES.join(','),
  })
}

/** Processor shared by the digest worker's repeatables. */
export const notificationDigestProcessor = async (job: {
  data: { cadence: DigestCadence }
}): Promise<DigestRunSummary> => runNotificationDigests(job.data.cadence)
