import { IDENTITY_BASE } from './api'
import { parseEventStream } from './sse'

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

/**
 * Resolve the destination for a notification without coupling routing to the
 * bell UI. New server rows carry a recipient-correct href; older rows fall back
 * to the analysis route that the bell used before hrefs were added.
 */
export function notificationHref(notification: Pick<AppNotification, 'data'>): string | null {
  const href = notification.data.href
  if (typeof href === 'string' && href.length > 0) return href

  const serverJobId = notification.data.server_job_id
  if (typeof serverJobId === 'string' && serverJobId.length > 0) {
    return `/dashboard/analysis/${encodeURIComponent(serverJobId)}`
  }

  return null
}

type NotificationsState = {
  notifications: AppNotification[]
  unread_count: number
}

type NotificationEvent = AppNotification

// Delivery-dedup for the CLIENT notification stream (NotificationBell).
// Module-scoped like the attribution cache: safe because subscription only
// ever runs in the browser — a server-side subscriber would share dedup
// state across requests. Never import this module's stream fns server-side.
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
  const res = await fetch(`${IDENTITY_BASE}/api/me/notifications?limit=20`, {
    credentials: 'include',
  })
  if (!res.ok) {
    return { notifications: [], unread_count: 0 }
  }
  return res.json()
}

/**
 * Mark a single notification as read.
 */
export async function markRead(id: string): Promise<void> {
  await fetch(`${IDENTITY_BASE}/api/me/notifications/${id}/read`, {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * Mark all notifications as read.
 */
export async function markAllRead(): Promise<void> {
  await fetch(`${IDENTITY_BASE}/api/me/notifications/read-all`, {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * Subscribe to the SSE notification stream. Each event is a full
 * `AppNotification` object. The signal controls connection lifecycle — aborting
 * it closes the SSE connection. Stream errors and closes use bounded
 * exponential backoff (10s, 20s, 40s, then 60s); after the outage budget the
 * stream waits for connectivity/visibility instead of reconnecting forever.
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
  let reconnectAttempt = 0
  let isConnecting = false
  let isStreaming = false
  const maxReconnectAttempts = 6
  const reconnectDelays = [10_000, 20_000, 40_000, 60_000]

  const clearReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = () => {
    if (controller.signal.aborted || reconnectAttempt >= maxReconnectAttempts) return
    const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function connect() {
    if (controller.signal.aborted || isConnecting || isStreaming) return
    isConnecting = true
    try {
      const res = await fetch(`${IDENTITY_BASE}/api/me/notifications/sse`, {
        signal: controller.signal,
        credentials: 'include',
      })

      if (!res.ok || !res.body) return
      isStreaming = true
      reconnectAttempt = 0

      for await (const event of parseEventStream<NotificationEvent>(res)) {
        // Skip connected handshake
        if ('connected' in event && (event as { connected?: boolean }).connected) continue
        if (!('id' in event)) continue

        const n = event as AppNotification
        reconnectAttempt = 0
        if (rememberDelivered(n.id)) continue
        onEvent(n)
      }
    } catch {
      // Fall through — scheduleReconnect handles the bounded reconnection policy.
    } finally {
      isConnecting = false
      isStreaming = false
    }
    scheduleReconnect()
  }

  const onOnline = () => {
    if (controller.signal.aborted || isConnecting || isStreaming) return
    reconnectAttempt = 0
    clearReconnect()
    void connect()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') onOnline()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibilityChange)
  void connect()

  return () => {
    clearReconnect()
    outerSignal.removeEventListener('abort', onAbort)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    controller.abort()
  }
}
