import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import { requireVerifiedSelf } from '../lib/caller'
import {
  listNotifications,
  unreadCount,
  markNotificationRead,
  markAllRead,
  onNotification,
} from '../lib/notifications'
import { onServerEventBusDisconnect, startServerEventBus } from '../lib/serverEvents'

export type NotificationsRouteDeps = {
  startBus?: typeof startServerEventBus
  onNotification?: typeof onNotification
  onBusDisconnect?: typeof onServerEventBusDisconnect
}

export const notificationsRoute = (deps: NotificationsRouteDeps = {}) => {
  const startBus = deps.startBus ?? startServerEventBus
  const subscribeNotification = deps.onNotification ?? onNotification
  const subscribeToDisconnect = deps.onBusDisconnect ?? onServerEventBusDisconnect

  return (
    new Elysia({ name: 'notifications' })
      .use(serviceGuard)

      // ── GET /api/me/notifications — list + unread count ─────────────────────
      .get('/api/me/notifications', async ({ request, set }) => {
        const verified = requireVerifiedSelf({ request, set })
        if (typeof verified !== 'string') return verified

        const url = new URL(request.url)
        const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100)
        const unreadOnly = url.searchParams.get('unreadOnly') === '1'

        const [notifications, unread] = await Promise.all([
          listNotifications(verified, { limit, unreadOnly }),
          unreadCount(verified),
        ])

        set.status = 200
        return { notifications, unread_count: unread }
      })

      // ── GET /api/me/notifications/sse — SSE stream ─────────────────────────
      .get('/api/me/notifications/sse', async ({ request, set }) => {
        const verified = requireVerifiedSelf({ request, set })
        if (typeof verified !== 'string') return verified
        if (request.signal.aborted) return new Response(null, { status: 499 })

        // Register before starting so a subscriber that drops during startup
        // cannot leave a newly-created stream attached to a dead bus.
        let busDisconnected = false
        let closeStream = () => {}
        const unsubscribeDisconnect = subscribeToDisconnect(() => {
          busDisconnected = true
          closeStream()
        })
        let busAvailable: boolean
        try {
          busAvailable = await startBus()
        } catch (error) {
          unsubscribeDisconnect()
          throw error
        }
        if (!busAvailable) {
          unsubscribeDisconnect()
          set.status = 503
          return buildError(
            'NOTIFICATION_EVENT_STREAM_UNAVAILABLE',
            'Live notification updates are temporarily unavailable.',
            true,
          )
        }

        if (busDisconnected) {
          unsubscribeDisconnect()
          set.status = 503
          return buildError(
            'NOTIFICATION_EVENT_STREAM_UNAVAILABLE',
            'Live notification updates are temporarily unavailable.',
            true,
          )
        }
        if (request.signal.aborted) {
          unsubscribeDisconnect()
          return new Response(null, { status: 499 })
        }

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            let closed = false
            let heartbeat: ReturnType<typeof setInterval> | null = null
            let unsubscribe = () => {}

            const close = () => {
              if (closed) return
              closed = true
              if (heartbeat) clearInterval(heartbeat)
              unsubscribe()
              unsubscribeDisconnect()
              try {
                controller.close()
              } catch {
                // The client may already have closed the stream.
              }
            }
            closeStream = close

            const send = (data: string) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(`data: ${data}\n\n`))
              } catch {
                close()
              }
            }

            // Initial connected event
            send(JSON.stringify({ connected: true }))

            // Subscribe after the shared bus is ready; events are wake-ups and
            // the browser reconciles the durable list after each one.
            unsubscribe = subscribeNotification(verified, (n) => {
              send(JSON.stringify(n))
            })
            if (busDisconnected) {
              close()
              return
            }

            heartbeat = setInterval(() => {
              send(JSON.stringify({ type: 'heartbeat' }))
            }, 30_000)
            request.signal.addEventListener('abort', close, { once: true })
          },
          cancel() {
            closeStream()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      })

      // ── POST /api/me/notifications/:id/read — mark single read ─────────────
      .post('/api/me/notifications/:id/read', async ({ request, params, set }) => {
        const verified = requireVerifiedSelf({ request, set })
        if (typeof verified !== 'string') return verified

        const updated = await markNotificationRead(verified, params.id)
        if (!updated) {
          set.status = 404
          return buildError('NOT_FOUND', 'Notification not found', false)
        }

        set.status = 200
        return { notification: updated }
      })

      // ── POST /api/me/notifications/read-all — mark all read ─────────────────
      .post('/api/me/notifications/read-all', async ({ request, set }) => {
        const verified = requireVerifiedSelf({ request, set })
        if (typeof verified !== 'string') return verified

        await markAllRead(verified)
        set.status = 200
        return { ok: true }
      })
  )
}

export default notificationsRoute()
