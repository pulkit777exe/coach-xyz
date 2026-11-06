// ── Notifications events (fan-out seam) ────────────────────────────────────
// In-process pub/sub for SSE endpoints. Notification creation is a direct
// call from the analysis worker (no queue hooks, no Redis). Persistence
// lives in ./notificationsStore.

import { EventEmitter } from 'events'

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

// ── Analysis outcome notifications ───────────────────────────────────────────
// The worker calls this directly on completion or permanent failure. No queue
// events, no Redis connection.

export type AnalysisOutcome = 'completed' | 'failed'

/**
 * Notify the owning coach of an analysis outcome. Anonymous jobs (no resolvable
 * owner) produce no notification — there is no one to tell.
 */
export async function notifyAnalysisOutcome(
  serverJobId: string,
  engineJobId: string,
  outcome: AnalysisOutcome,
): Promise<void> {
  try {
    const analysis = await resolveAnalysisOwner(serverJobId)
    if (!analysis) return

    await createNotification({
      auth0Id: analysis.auth0Id,
      type: outcome === 'completed' ? 'analysis_complete' : 'analysis_failed',
      title: outcome === 'completed' ? 'Analysis complete' : 'Analysis failed',
      body: analysis.displayName || engineJobId,
      data: {
        server_job_id: serverJobId,
        engine_job_id: engineJobId,
      },
    })
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'notification_outcome_error',
        outcome,
        serverJobId,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}
