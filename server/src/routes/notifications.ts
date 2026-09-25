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

export default new Elysia()
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

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        const send = (data: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch {
            // stream closed
          }
        }

        // Initial connected event
        send(JSON.stringify({ connected: true }))

        // Subscribe to new notifications
        const unsub = onNotification(verified, (n) => {
          send(JSON.stringify(n))
        })

        // Heartbeat every 30s
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`))
          } catch {
            clearInterval(heartbeat)
          }
        }, 30_000)

        // Cleanup on disconnect
        request.signal.addEventListener('abort', () => {
          unsub()
          clearInterval(heartbeat)
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        })
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
