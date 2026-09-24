import { EventEmitter } from 'events'
import type { QueueEvents } from 'bullmq'

import { orDisabledDefault, withHistoryStore } from './historyStore'
import { getAnalysisByServerJobId } from './analyses'
import { analysisQueue, queueEvents, classifyFailure, onQueueInfrastructureReady } from './queue'

// ── In-process pub/sub ───────────────────────────────────────────────────────
// Lightweight fan-out so SSE endpoints get notified when a new notification is
// created.  In production a Redis PUBLISH could replace this, but an in-memory
// EventEmitter is sufficient for single-instance dev and keeps the codebase
// dependency-free.

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

type NotificationEvent = {
  auth0Id: string
  notification: NotificationRow
}

const bus = new EventEmitter()
bus.setMaxListeners(200)

export function onNotification(auth0Id: string, handler: (n: NotificationRow) => void): () => void {
  const listener = (evt: NotificationEvent) => {
    if (evt.auth0Id === auth0Id) handler(evt.notification)
  }
  bus.on('notification', listener)
  return () => bus.off('notification', listener)
}

function publish(auth0Id: string, notification: NotificationRow) {
  bus.emit('notification', {
    auth0Id,
    notification,
  } satisfies NotificationEvent)
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────
// Table bootstrap lives in historyStore.ensureInitialized — the module owns a
// single schema mechanism, so every wrapped query below can assume the
// notifications table exists (the wrapper initializes before the callback).

export type CreateNotificationInput = {
  auth0Id: string
  type: string
  title: string
  body?: string | null
  data?: Record<string, unknown>
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const result = await withHistoryStore(async (db) => {
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

  if (result) publish(input.auth0Id, result)
  return result
}

export async function listNotifications(
  auth0Id: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const { limit = 20, unreadOnly = false } = opts
  const unreadFilter = unreadOnly ? 'and read = false' : ''
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      return db<NotificationRow[]>`
      select * from notifications
      where auth0_id = ${auth0Id}
        ${db.unsafe(unreadFilter)}
      order by created_at desc
      limit ${limit};
    `
    }),
    [],
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
  return orDisabledDefault(result, 0)
}

// ── BullMQ queue event hooks ─────────────────────────────────────────────────
// Listens for completed/failed analysis jobs and creates notifications for the
// owning coach.  Subscribes to the shared analysis queue + QueueEvents owned
// by queue.ts — one Redis wiring for the whole server.  queue.ts is inert at
// import, so attachment happens through onQueueInfrastructureReady: it runs
// exactly once per built queueEvents instance, whether this module loads
// before or after startQueueInfrastructure().

/**
 * Resolves the owner (+ label) of an analysis. `getAnalysisByServerJobId` is the
 * primary source; falls back to a direct `analysis_history` query when its
 * auth0_id is absent (the dashboard SELECT does not always project it).
 */
type AnalysisOwner = { auth0Id: string; displayName: string | null }

async function resolveAnalysisOwner(serverJobId: string): Promise<AnalysisOwner | null> {
  const analysis = await getAnalysisByServerJobId(serverJobId)
  if (analysis?.auth0_id) {
    return { auth0Id: analysis.auth0_id, displayName: analysis.display_name }
  }

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

/** The queueEvents instance the listeners are bound to — guards against
 *  double-attaching to the same instance (and re-attaches after a stop/start
 *  cycle builds a fresh one). */
let attachedTo: QueueEvents | null = null

function attachQueueEventListeners() {
  if (!queueEvents || !analysisQueue || attachedTo === queueEvents) return
  attachedTo = queueEvents

  try {
    queueEvents.on('completed', async ({ jobId }: { jobId: string }) => {
      try {
        const job = await analysisQueue!.getJob(jobId)
        if (!job?.data?.server_job_id) return

        const analysis = await resolveAnalysisOwner(job.data.server_job_id)
        if (!analysis) return

        await createNotification({
          auth0Id: analysis.auth0Id,
          type: 'analysis_complete',
          title: 'Analysis complete',
          body: analysis.displayName || job.data.engine_job_id,
          data: {
            server_job_id: job.data.server_job_id,
            engine_job_id: job.data.engine_job_id,
          },
        })
      } catch (err) {
        console.error(
          JSON.stringify({
            type: 'notification_completed_handler_error',
            jobId,
            error: err instanceof Error ? err.message : 'unknown',
          }),
        )
      }
    })

    queueEvents.on(
      'failed',
      async ({ jobId, failedReason }: { jobId: string; failedReason?: string }) => {
        try {
          const job = await analysisQueue!.getJob(jobId)
          if (!job?.data?.server_job_id) return

          // Same policy the queue's failed-handler applies — one shared
          // predicate (classifyFailure in queue.ts), never a local copy.
          const { isFinalFailure } = classifyFailure(
            failedReason,
            job.attemptsMade,
            job.opts?.attempts,
          )
          if (!isFinalFailure) return

          const analysis = await resolveAnalysisOwner(job.data.server_job_id)
          if (!analysis) return

          await createNotification({
            auth0Id: analysis.auth0Id,
            type: 'analysis_failed',
            title: 'Analysis failed',
            body: analysis.displayName || job.data.engine_job_id,
            data: {
              server_job_id: job.data.server_job_id,
              engine_job_id: job.data.engine_job_id,
            },
          })
        } catch (err) {
          console.error(
            JSON.stringify({
              type: 'notification_failed_handler_error',
              jobId,
              error: err instanceof Error ? err.message : 'unknown',
            }),
          )
        }
      },
    )
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'notification_queue_events_init_error',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}

// Attach when the queue infrastructure starts (or immediately when it is
// already running) — importing this module alone must not touch Redis.
onQueueInfrastructureReady(attachQueueEventListeners)
