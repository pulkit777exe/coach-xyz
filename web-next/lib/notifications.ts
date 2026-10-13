import { mutateJson, queryJson } from './data/client'
import { identityBase, meUrl } from './data/transport'
import { parseEventStream } from './sse'

const IDENTITY_BASE: string = identityBase()

/** Notification row as stored server-side. */
export type AppNotification = {
  id: string
  auth0_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

type NotificationsState = {
  notifications: AppNotification[]
  unread_count: number
}

type NotificationEvent = AppNotification

const dedupeSet = new Set<string>()

const DEDUPE_CAP = 10_000
function rememberDelivered(id: string): boolean {
  if (dedupeSet.has(id)) return true
  if (dedupeSet.size >= DEDUPE_CAP) dedupeSet.clear()
  dedupeSet.add(id)
  return false
}

/**
 * Fetch the current notification list + unread count from the self-scoped API.
 * No auth0Id needed — the proxy injects identity via the session.
 */
export async function fetchNotifications(): Promise<NotificationsState> {
  try {
    return await queryJson<NotificationsState>(meUrl('/notifications?limit=20'))
  } catch {
    return { notifications: [], unread_count: 0 }
  }
}

/**
 * Mark a single notification as read.
 */
export async function markRead(id: string): Promise<void> {
  await mutateJson(meUrl(`/notifications/${id}/read`), 'POST').catch(() => undefined)
}

/**
 * Mark all notifications as read.
 */
export async function markAllRead(): Promise<void> {
  await mutateJson(meUrl('/notifications/read-all'), 'POST').catch(() => undefined)
}

/**
 * Subscribe to the SSE notification stream. Each event is a full
 * `AppNotification` object. The signal controls connection lifecycle — aborting
 * it closes the SSE connection. Stream errors and closes are both handled with
 * a 10-second backoff before reconnecting (never a tight loop).
 *
 * Returns an unsubscribe function that also aborts the stream.
 */
export function subscribeNotifications(
  onEvent: (n: AppNotification) => void,
  signal: AbortSignal,
): () => void {
  const controller = new AbortController()
  const outerSignal = signal

  // Tie external abort to our controller
  const onAbort = () => controller.abort()
  outerSignal.addEventListener('abort', onAbort)

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleReconnect = () => {
    if (controller.signal.aborted) return
    reconnectTimer = setTimeout(connect, 10_000)
  }

  async function connect() {
    try {
      const res = await fetch(`${IDENTITY_BASE}/api/me/notifications/sse`, {
        signal: controller.signal,
        credentials: 'include',
      })

      if (!res.ok || !res.body) return

      for await (const event of parseEventStream<NotificationEvent>(res)) {
        // Skip connected handshake
        if ('connected' in event && (event as { connected?: boolean }).connected) continue
        if (!('id' in event)) continue

        const n = event as AppNotification
        if (rememberDelivered(n.id)) continue
        onEvent(n)
      }
    } catch {
      // Fall through — scheduleReconnect handles the reconnection backoff
    }
    scheduleReconnect()
  }

  connect()

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    outerSignal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
