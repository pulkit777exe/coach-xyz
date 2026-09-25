import { describe, expect, test } from 'bun:test'

import { notificationsRoute } from '../src/routes/notifications'
import type { NotificationRow } from '../src/lib/notifications'

const VERIFIED = 'auth0|notification-route-test'

const requestHeaders = (): Record<string, string> => ({
  'x-verified-auth0-id': VERIFIED,
  ...(process.env.SERVICE_TOKEN ? { 'x-service-token': process.env.SERVICE_TOKEN } : {}),
})

function readWithTimeout<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ])
}

describe('notification SSE route', () => {
  test('returns a bounded 503 when the shared bus is unavailable', async () => {
    const route = notificationsRoute({ startBus: async () => false })
    const response = await route.handle(
      new Request('http://localhost/api/me/notifications/sse', {
        headers: requestHeaders(),
      }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'NOTIFICATION_EVENT_STREAM_UNAVAILABLE',
      retryable: true,
    })
  })

  test('delivers a notification and cleans up when the bus disconnects', async () => {
    let notificationHandler: ((notification: NotificationRow) => void) | null = null
    let disconnectHandler: (() => void) | null = null
    let unsubscribed = false
    let disconnectUnsubscribed = false
    const route = notificationsRoute({
      startBus: async () => true,
      onNotification: (_auth0Id, handler) => {
        notificationHandler = handler
        return () => {
          unsubscribed = true
        }
      },
      onBusDisconnect: (handler) => {
        disconnectHandler = handler
        return () => {
          disconnectUnsubscribed = true
        }
      },
    })
    const controller = new AbortController()
    const response = await route.handle(
      new Request('http://localhost/api/me/notifications/sse', {
        headers: requestHeaders(),
        signal: controller.signal,
      }),
    )

    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    if (!reader) return

    const first = await readWithTimeout(reader.read())
    expect(new TextDecoder().decode(first.value)).toContain('"connected":true')
    expect(notificationHandler).not.toBeNull()

    notificationHandler!({
      id: 'notification-route-test',
      auth0_id: VERIFIED,
      type: 'report_ready',
      title: 'Report ready',
      body: null,
      data: {},
      read: false,
      created_at: new Date(0).toISOString(),
    })
    const second = await readWithTimeout(reader.read())
    expect(new TextDecoder().decode(second.value)).toContain('notification-route-test')

    disconnectHandler!()
    await readWithTimeout(reader.read())
    expect(unsubscribed).toBe(true)
    expect(disconnectUnsubscribed).toBe(true)
  })

  test('does not open a stream for an already-aborted request', async () => {
    let started = false
    const route = notificationsRoute({
      startBus: async () => {
        started = true
        return true
      },
    })
    const controller = new AbortController()
    controller.abort()
    const response = await route.handle(
      new Request('http://localhost/api/me/notifications/sse', {
        headers: requestHeaders(),
        signal: controller.signal,
      }),
    )

    expect(response.status).toBe(499)
    expect(started).toBe(false)
  })
})
