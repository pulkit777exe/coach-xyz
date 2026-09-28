// ── Notification write path ─────────────────────────────────────────────────
// `createNotification` lives apart from the read/query half of notifications.ts
// for one reason: the emission seam (`notificationEvents.ts`) needs it as its
// default transport, and notifications.ts also wants to emit *through* that seam
// from its queue handlers. With both in one module that is a cycle —
// notificationEvents -> notifications -> notificationEvents — and the seam's
// helpers would have to stay unused, which is how `notifyAnalysisResult` ended up
// with zero call sites and `notifyMembershipChanged` with none either.
//
// This module is a leaf: historyStore, notificationPrefs, serverEvents and logger
// all point away from it, so both halves can depend on it safely.
//
// The row is inserted, then published over SSE. The publish is deliberately
// fire-and-forget (`void ... .catch`) — a subscriber that misses a frame still
// gets it from the next snapshot — but a publish failure is logged rather than
// swallowed.

import { withHistoryStore } from './historyStore'
import { logger } from './logger'
import { isEventEnabled } from './notificationPrefs'
import { publishNotification } from './serverEvents'

export type NotificationRow = {
  id: string
  auth0_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read: boolean
  dedupe_key?: string | null
  created_at: string
}

export type CreateNotificationInput = {
  auth0Id: string
  type: string
  title: string
  body?: string | null
  data?: Record<string, unknown>
  /** Internal idempotency key for queue-derived notifications. */
  dedupeKey?: string | null
}

/**
 * `data` arrives as an object on a fresh insert. It is read back through
 * `select *` elsewhere, and a row written before the jsonb bind was fixed stores
 * the JSON text inside a jsonb *string* — so this tolerates that shape rather
 * than handing a string to a consumer that expects `data.href`.
 */
const normalizeNotificationData = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch (error) {
      logger.error('notification_data_parse_failed', {
        type: 'notification_data_parse_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return {}
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  if (!(await isEventEnabled(input.auth0Id, input.type))) return null

  const result = await withHistoryStore(async (db) => {
    const rows = await db<NotificationRow[]>`
      insert into notifications (auth0_id, type, title, body, data, dedupe_key)
      values (
        ${input.auth0Id},
        ${input.type},
        ${input.title},
        ${input.body ?? null},
        ${input.data ?? {}}::jsonb,
        ${input.dedupeKey ?? null}
      )
      on conflict do nothing
      returning *;
    `
    return rows?.[0] ?? null
  })

  if (result) {
    const createdAt = new Date(result.created_at as unknown as string | number | Date).toISOString()
    const data = normalizeNotificationData(result.data)
    void publishNotification({
      id: result.id,
      auth0_id: result.auth0_id,
      type: result.type,
      title: result.title,
      body: result.body,
      data,
      read: result.read,
      created_at: createdAt,
    }).catch((error: unknown) => {
      logger.error('notification_event_publish_error', {
        type: 'notification_event_publish_error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  return result
}
