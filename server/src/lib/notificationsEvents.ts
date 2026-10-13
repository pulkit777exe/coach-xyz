// ── Notifications events (fan-out seam) ────────────────────────────────────
// In-process pub/sub for SSE endpoints plus BullMQ completed/failed hooks
// that notify owning coaches. Persistence lives in ./notificationsStore;
// queue connectivity comes from the shared ./queueConnection builder (not a
// fork). The connection is injectable via attachNotificationQueueEvents for
// tests; production auto-attaches at import when Redis is configured.

import { EventEmitter } from 'events'

import type { Queue as BullQueue } from 'bullmq'
import type { Redis } from 'ioredis'

import { buildQueueConnection } from './queueConnection'
import {
  createNotificationRow,
  getAnalysisOwnerRow,
  type CreateNotificationInput,
  type NotificationRow,
} from './notificationsStore'
import { getAnalysisByServerJobId } from './analyses'

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

/** Persist a notification and fan it out to SSE subscribers. */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const result = await createNotificationRow(input)
  if (result) publish(input.auth0Id, result)
  return result
}

/**
 * Resolves the owner (+ label) of an analysis. `getAnalysisByServerJobId` is the
 * primary source; falls back to the store's direct lookup when its
 * auth0_id is absent (the dashboard SELECT does not always project it).
 */
type AnalysisOwner = { auth0Id: string; displayName: string | null }

async function resolveAnalysisOwner(serverJobId: string): Promise<AnalysisOwner | null> {
  const analysis = await getAnalysisByServerJobId(serverJobId)
  if (analysis?.auth0_id) {
    return { auth0Id: analysis.auth0_id, displayName: analysis.display_name }
  }
  return getAnalysisOwnerRow(serverJobId)
}

// ── BullMQ queue event hooks ─────────────────────────────────────────────────
// Listens for completed/failed analysis jobs and creates notifications for the
// owning coach.  Replicates the Redis connection setup from queue.ts without
// importing or modifying it.

type AnalysisQueueJobData = {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  video_key: string | null
}

const queueEventsConnection = buildQueueConnection('notifications-events')
let analysisQueue: BullQueue<AnalysisQueueJobData> | null = null

export function attachNotificationQueueEvents(connection: Redis | null = queueEventsConnection) {
  if (!connection) return

  try {
    const { QueueEvents: QueueEventsClass, Queue } = require('bullmq')
    const qe = new QueueEventsClass('coachai-analysis', {
      connection,
    })
    analysisQueue = new Queue('coachai-analysis', {
      connection,
    }) as BullQueue<AnalysisQueueJobData>

    qe.on('completed', async ({ jobId }: { jobId: string }) => {
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

    qe.on('failed', async ({ jobId, failedReason }: { jobId: string; failedReason?: string }) => {
      try {
        const job = await analysisQueue!.getJob(jobId)
        if (!job?.data?.server_job_id) return

        const isUnrecoverable = failedReason?.includes('UnrecoverableError')
        const retriesExhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3)
        if (!retriesExhausted && !isUnrecoverable) return

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
    })
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'notification_queue_events_init_error',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}

// Attach lazily — if Redis is available
attachNotificationQueueEvents()
