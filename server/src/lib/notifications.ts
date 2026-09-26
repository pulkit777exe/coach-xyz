import type { QueueEvents } from 'bullmq'

import { orDisabledDefault, withHistoryStore } from './historyStore'
import { getAnalysisByServerJobId } from './analyses'
import { analysisQueue, queueEvents, classifyFailure, onQueueInfrastructureReady } from './queue'
import { isEventEnabled } from './notificationPrefs'
import { analysisResultHref, NOTIFICATION_EVENT } from './notificationEventNames'
import { logger } from './logger'
import { publishNotification, subscribeNotification } from './serverEvents'

// Notification rows are durable in Postgres. The shared Redis bus is only a
// wake-up signal for authenticated SSE routes; each replica dispatches locally
// and the browser reconciles a snapshot after every event/reconnect.

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

export function onNotification(auth0Id: string, handler: (n: NotificationRow) => void): () => void {
  return subscribeNotification(auth0Id, handler)
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────
// Table bootstrap lives in historyStore.ensureInitialized — the module owns a
// single schema mechanism, so every wrapped query below can assume the
// notifications table exists (the wrapper initializes before the callback).

function normalizeNotificationData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return {}
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
  return {}
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
        ${JSON.stringify(input.data ?? {})}::jsonb,
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
type AnalysisOwner = {
  auth0Id: string
  requestedBy: string | null
  displayName: string | null
}

export const analysisNotificationRecipients = (
  ownerAuth0Id: string,
  requestedBy: string | null,
): string[] =>
  requestedBy && requestedBy !== ownerAuth0Id ? [ownerAuth0Id, requestedBy] : [ownerAuth0Id]

async function resolveAnalysisOwner(serverJobId: string): Promise<AnalysisOwner | null> {
  const analysis = await getAnalysisByServerJobId(serverJobId)
  if (analysis?.auth0_id) {
    return {
      auth0Id: analysis.auth0_id,
      requestedBy: analysis.requested_by,
      displayName: analysis.display_name,
    }
  }

  const owner = await withHistoryStore(async (db) => {
    const rows = await db<
      { auth0_id: string | null; requested_by: string | null; display_name: string | null }[]
    >`
      select auth0_id, requested_by, display_name from analysis_history
      where server_job_id = ${serverJobId}
      limit 1;
    `
    const row = rows?.[0]
    return row?.auth0_id
      ? {
          auth0Id: row.auth0_id,
          requestedBy: row.requested_by,
          displayName: row.display_name,
        }
      : null
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

        for (const auth0Id of analysisNotificationRecipients(
          analysis.auth0Id,
          analysis.requestedBy,
        )) {
          await createNotification({
            auth0Id,
            type: NOTIFICATION_EVENT.analysisComplete,
            title: 'Analysis complete',
            body: analysis.displayName || job.data.engine_job_id,
            data: {
              server_job_id: job.data.server_job_id,
              engine_job_id: job.data.engine_job_id,
              href: analysisResultHref(
                analysis.auth0Id,
                auth0Id,
                job.data.server_job_id as string,
              ),
            },
            dedupeKey: `analysis_complete:${job.data.server_job_id}:${auth0Id}`,
          })
        }
      } catch (err) {
        logger.error('notification_completed_handler_error', {
          type: 'notification_completed_handler_error',
          jobId,
          error: err instanceof Error ? err.message : 'unknown',
        })
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

          for (const auth0Id of analysisNotificationRecipients(
            analysis.auth0Id,
            analysis.requestedBy,
          )) {
            await createNotification({
              auth0Id,
              type: NOTIFICATION_EVENT.analysisFailed,
              title: 'Analysis failed',
              body: analysis.displayName || job.data.engine_job_id,
              data: {
                server_job_id: job.data.server_job_id,
                engine_job_id: job.data.engine_job_id,
                href: analysisResultHref(
                  analysis.auth0Id,
                  auth0Id,
                  job.data.server_job_id as string,
                ),
              },
              dedupeKey: `analysis_failed:${job.data.server_job_id}:${auth0Id}`,
            })
          }
        } catch (err) {
          logger.error('notification_failed_handler_error', {
            type: 'notification_failed_handler_error',
            jobId,
            error: err instanceof Error ? err.message : 'unknown',
          })
        }
      },
    )
  } catch (err) {
    logger.error('notification_queue_events_init_error', {
      type: 'notification_queue_events_init_error',
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
}

// Attach when the queue infrastructure starts (or immediately when it is
// already running) — importing this module alone must not touch Redis.
onQueueInfrastructureReady(attachQueueEventListeners)
