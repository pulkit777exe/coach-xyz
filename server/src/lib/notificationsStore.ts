// ── Notifications store (persistence seam) ─────────────────────────────────
// SQL reads/writes for notifications plus the analysis-owner lookup the
// event handlers need. No bus, no queue wiring — the event fan-out lives
// in ./notificationsEvents, which calls createNotificationRow and publishes.

import { withHistoryStore } from './historyStore'

export type NotificationRow = {
  id: string
  auth0_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

export type CreateNotificationInput = {
  auth0Id: string
  type: string
  title: string
  body?: string | null
  data?: Record<string, unknown>
}

export type AnalysisOwner = { auth0Id: string; displayName: string | null }

// ── CRUD helpers ─────────────────────────────────────────────────────────────

export async function createNotificationRow(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  return withHistoryStore(async (db) => {
    const rows = await db<NotificationRow[]>`
      insert into notifications (auth0_id, type, title, body, data)
      values (
        ${input.auth0Id},
        ${input.type},
        ${input.title},
        ${input.body ?? null},
        ${JSON.stringify(input.data ?? {})}::jsonb
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export async function listNotifications(
  auth0Id: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const { limit = 20, unreadOnly = false } = opts
  const unreadFilter = unreadOnly ? 'and read = false' : ''
  return (
    (await withHistoryStore(async (db) => {
      return db<NotificationRow[]>`
      select * from notifications
      where auth0_id = ${auth0Id}
        ${db.unsafe(unreadFilter)}
      order by created_at desc
      limit ${limit};
    `
    })) ?? []
  )
}

export async function markNotificationRead(
  auth0Id: string,
  id: string,
): Promise<NotificationRow | null> {
  return withHistoryStore(async (db) => {
    const rows = await db<NotificationRow[]>`
      update notifications set read = true
      where id = ${id} and auth0_id = ${auth0Id}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export async function markAllRead(auth0Id: string): Promise<void> {
  await withHistoryStore(async (db) => {
    await db`
      update notifications set read = true
      where auth0_id = ${auth0Id} and read = false;
    `
  })
}

export async function unreadCount(auth0Id: string): Promise<number> {
  const result = await withHistoryStore(async (db) => {
    const rows = await db<{ count: number }[]>`
      select count(*)::int as count from notifications
      where auth0_id = ${auth0Id} and read = false;
    `
    return rows?.[0]?.count ?? 0
  })
  return result ?? 0
}

/**
 * Owner (+ label) of an analysis for event addressing. The dashboard
 * SELECT does not always project auth0_id, so this reads it directly.
 */
export const getAnalysisOwnerRow = async (serverJobId: string): Promise<AnalysisOwner | null> => {
  const owner = await withHistoryStore(async (db) => {
    const rows = await db<{ auth0_id: string | null; display_name: string | null }[]>`
      select auth0_id, display_name from analysis_history
      where server_job_id = ${serverJobId}
      limit 1;
    `
    const row = rows?.[0]
    return row?.auth0_id ? { auth0Id: row.auth0_id, displayName: row.display_name } : null
  })
  return owner ?? null
}
