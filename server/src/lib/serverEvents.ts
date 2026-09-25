// ── Shared server event bus ──────────────────────────────────────────────────
// Report and notification state is durable in Redis/Postgres. These channels
// are wake-up signals only: the receiving SSE route reconciles from its
// authoritative snapshot after every event. A local dispatch keeps the module
// useful in single-process/dev mode when Redis is not configured; when Redis is
// configured, the same envelope crosses server replicas.

import type { Redis as IORedis } from 'ioredis'

import { getRedisConnectionUrl, isLocalRedis } from './redis'
import { logger } from './logger'

export const REPORT_EVENT_CHANNEL = 'coachai:server-report-events:v1'
export const NOTIFICATION_EVENT_CHANNEL = 'coachai:server-notification-events:v1'
export const SERVER_EVENT_VERSION = 1

export type ServerEventKind = 'report-job' | 'notification'
type EventHandler = (payload: unknown) => void
type DisconnectHandler = () => void
type ClientFactory = (url: string) => IORedis

export type ReportEventPayload = {
  report_job_id: string
  auth0_id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  report_id: string | null
  error: string | null
  progress: number
  created_at: number
  updated_at: number
}

export type NotificationEventPayload = {
  id: string
  auth0_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

type Envelope = {
  version: typeof SERVER_EVENT_VERSION
  origin: string
  kind: ServerEventKind
  payload: unknown
}

export type ServerEventBus = {
  start: () => Promise<boolean>
  stop: () => Promise<void>
  publish: (kind: ServerEventKind, channel: string, payload: unknown) => Promise<boolean>
  subscribe: (channel: string, handler: EventHandler) => () => void
  onDisconnect: (handler: DisconnectHandler) => () => void
}

type BusOptions = {
  getUrl?: () => string | null
  localRedis?: () => boolean
  createClient?: ClientFactory
  origin?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isReportPayload(value: unknown): value is ReportEventPayload {
  if (!isRecord(value)) return false
  return (
    typeof value.report_job_id === 'string' &&
    typeof value.auth0_id === 'string' &&
    (value.status === 'queued' ||
      value.status === 'running' ||
      value.status === 'done' ||
      value.status === 'failed') &&
    (value.report_id === null || typeof value.report_id === 'string') &&
    (value.error === null || typeof value.error === 'string') &&
    isFiniteNumber(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 100 &&
    isFiniteNumber(value.created_at) &&
    isFiniteNumber(value.updated_at)
  )
}

function isNotificationPayload(value: unknown): value is NotificationEventPayload {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.auth0_id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.title === 'string' &&
    (value.body === null || typeof value.body === 'string') &&
    isRecord(value.data) &&
    typeof value.read === 'boolean' &&
    typeof value.created_at === 'string'
  )
}

function parseEnvelope(raw: string, channel: string): Envelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope>
    if (parsed.version !== SERVER_EVENT_VERSION) return null
    if (typeof parsed.origin !== 'string') return null
    if (parsed.kind !== 'report-job' && parsed.kind !== 'notification') {
      return null
    }
    if (parsed.kind === 'report-job') {
      if (channel !== REPORT_EVENT_CHANNEL || !isReportPayload(parsed.payload)) return null
    } else if (channel !== NOTIFICATION_EVENT_CHANNEL || !isNotificationPayload(parsed.payload)) {
      return null
    }
    return parsed as Envelope
  } catch {
    return null
  }
}

function defaultClientFactory(url: string, local: boolean): IORedis {
  const IORedisCtor = require('ioredis') as typeof import('ioredis').default
  return new IORedisCtor(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      if (times > 10) return null
      return Math.min(times * 500, 5000)
    },
    ...(local ? {} : { tls: {} }),
  })
}

function attachClientLogging(client: IORedis, role: 'publisher' | 'subscriber'): void {
  client.on('error', (error: Error) => {
    logger.error('server_event_redis_error', {
      type: 'server_event_redis_error',
      role,
      error: error.message,
    })
  })
  client.on('reconnecting', (delay: number) => {
    logger.warn('server_event_redis_reconnecting', {
      type: 'server_event_redis_reconnecting',
      role,
      delay_ms: delay,
    })
  })
}

const CLIENT_CLOSE_TIMEOUT_MS = 1_500

async function closeClient(client: IORedis | null): Promise<void> {
  if (!client) return
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      client.quit(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLIENT_CLOSE_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
  } catch {
    // The disconnect in the finally block is the bounded fallback.
  } finally {
    if (timer) clearTimeout(timer)
    client.disconnect()
  }
}

export function createServerEventBus(options: BusOptions = {}): ServerEventBus {
  const getUrl = options.getUrl ?? getRedisConnectionUrl
  const localRedis = options.localRedis ?? isLocalRedis
  const createClient: ClientFactory =
    options.createClient ?? ((url: string) => defaultClientFactory(url, localRedis()))
  const origin = options.origin ?? crypto.randomUUID()
  const subscribers = new Map<string, Set<EventHandler>>()
  const disconnectHandlers = new Set<DisconnectHandler>()
  const channels = [REPORT_EVENT_CHANNEL, NOTIFICATION_EVENT_CHANNEL]

  let subscriber: IORedis | null = null
  let publisher: IORedis | null = null
  let startPromise: Promise<boolean> | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let stopRequested = false
  let lifecycleGeneration = 0

  const dispatch = (channel: string, payload: unknown): void => {
    const handlers = subscribers.get(channel)
    if (!handlers) return
    for (const handler of [...handlers]) {
      try {
        handler(payload)
      } catch (error) {
        logger.error('server_event_listener_error', {
          type: 'server_event_listener_error',
          channel,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const notifyDisconnect = (): void => {
    for (const handler of [...disconnectHandlers]) {
      try {
        handler()
      } catch (error) {
        logger.error('server_event_disconnect_listener_error', {
          type: 'server_event_disconnect_listener_error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const scheduleRestart = (): void => {
    if (stopRequested || restartTimer) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!stopRequested) {
        void start().catch((error: unknown) => {
          logger.error('server_event_bus_restart_failed', {
            type: 'server_event_bus_restart_failed',
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }, 5_000)
    restartTimer.unref?.()
  }

  const getPublisher = async (): Promise<IORedis | null> => {
    if (publisher) return publisher
    const url = getUrl()
    if (!url) return null
    const client = createClient(url)
    attachClientLogging(client, 'publisher')
    publisher = client
    const clearPublisher = () => {
      if (publisher === client) publisher = null
      // A closed publisher must not remain eligible for ioredis's automatic
      // reconnect loop; otherwise every transient disconnect leaks a socket.
      client.disconnect()
    }
    client.on('close', clearPublisher)
    client.on('end', clearPublisher)
    return client
  }

  const start = async (): Promise<boolean> => {
    stopRequested = false
    if (startPromise) return startPromise
    if (subscriber) return true
    const url = getUrl()
    // No Redis means local-only mode in development. Start still succeeds so
    // single-process development keeps the same SSE contract; production must
    // fail closed rather than silently pretending a missing/malformed Redis
    // configuration is cross-replica capable.
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('server_event_redis_unconfigured', {
          type: 'server_event_redis_unconfigured',
        })
      }
      return process.env.NODE_ENV !== 'production'
    }
    const generation = lifecycleGeneration
    startPromise = (async () => {
      let client: IORedis | null = null
      let closed = false
      try {
        client = createClient(url)
        subscriber = client
        attachClientLogging(client, 'subscriber')
        const onClosed = () => {
          if (closed) return
          closed = true
          if (subscriber === client) {
            subscriber = null
            // A Redis connection emits `close` before ioredis gives up its
            // automatic reconnect loop. Stop that old client before creating
            // the replacement, otherwise it can silently resubscribe and
            // duplicate every event after a transient outage.
            client?.disconnect()
            notifyDisconnect()
            scheduleRestart()
          }
        }
        client.on('close', onClosed)
        client.on('end', onClosed)
        client.on('message', (channel: string, message: string) => {
          if (subscriber !== client) return
          const envelope = parseEnvelope(message, channel)
          if (!envelope || envelope.origin === origin) return
          dispatch(channel, envelope.payload)
        })
        await client.subscribe(...channels)
        if (closed || stopRequested || generation !== lifecycleGeneration) {
          if (subscriber === client) subscriber = null
          await closeClient(client)
          return false
        }
        if (restartTimer) {
          clearTimeout(restartTimer)
          restartTimer = null
        }
        return true
      } catch (error) {
        if (subscriber === client) {
          subscriber = null
          // Startup can fail after a route has already subscribed; wake those
          // streams instead of leaving them attached to a torn-down client.
          notifyDisconnect()
        }
        logger.error('server_event_bus_start_failed', {
          type: 'server_event_bus_start_failed',
          error: error instanceof Error ? error.message : String(error),
        })
        await closeClient(client)
        scheduleRestart()
        return false
      } finally {
        startPromise = null
      }
    })()
    return startPromise
  }

  const stop = async (): Promise<void> => {
    stopRequested = true
    lifecycleGeneration += 1
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    const pending = startPromise
    if (pending) {
      let pendingTimer: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          pending.catch(() => false),
          new Promise<boolean>((resolve) => {
            pendingTimer = setTimeout(() => resolve(false), CLIENT_CLOSE_TIMEOUT_MS)
            pendingTimer.unref?.()
          }),
        ])
      } finally {
        if (pendingTimer) clearTimeout(pendingTimer)
      }
    }
    const currentSubscriber = subscriber
    const currentPublisher = publisher
    subscriber = null
    publisher = null
    // Wake route streams before dropping their handlers; otherwise a graceful
    // shutdown can leave heartbeat-only responses and their subscriptions
    // alive until the client happens to disconnect.
    notifyDisconnect()
    subscribers.clear()
    disconnectHandlers.clear()
    await closeClient(currentSubscriber)
    await closeClient(currentPublisher)
  }

  const publish = async (
    kind: ServerEventKind,
    channel: string,
    payload: unknown,
  ): Promise<boolean> => {
    const valid =
      (kind === 'report-job' && isReportPayload(payload)) ||
      (kind === 'notification' && isNotificationPayload(payload))
    if (!valid) {
      logger.error('server_event_publish_rejected', {
        type: 'server_event_publish_rejected',
        kind,
        channel,
      })
      return false
    }

    // Local delivery is immediate and remains available without Redis. The
    // origin marker makes the eventual Redis echo a no-op in this process.
    dispatch(channel, payload)
    const url = getUrl()
    // A producer may not have a local SSE subscriber (for example, a queue
    // worker or a short-lived API process). It must still publish to Redis so
    // subscribers on other replicas wake up; the local dispatch above remains
    // the no-Redis fallback.
    if (!url || stopRequested) return false
    let client: IORedis | null = null
    try {
      client = await getPublisher()
      if (!client) return false
      const envelope: Envelope = {
        version: SERVER_EVENT_VERSION,
        origin,
        kind,
        payload,
      }
      await client.publish(channel, JSON.stringify(envelope))
      return true
    } catch (error) {
      if (client) {
        if (publisher === client) publisher = null
        client.disconnect()
      }
      logger.error('server_event_publish_failed', {
        type: 'server_event_publish_failed',
        kind,
        channel,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  const subscribe = (channel: string, handler: EventHandler): (() => void) => {
    const handlers = subscribers.get(channel) ?? new Set<EventHandler>()
    handlers.add(handler)
    subscribers.set(channel, handlers)
    void start().catch((error: unknown) => {
      logger.error('server_event_bus_start_failed', {
        type: 'server_event_bus_start_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => {
      const current = subscribers.get(channel)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) subscribers.delete(channel)
    }
  }

  const onDisconnect = (handler: DisconnectHandler): (() => void) => {
    disconnectHandlers.add(handler)
    return () => disconnectHandlers.delete(handler)
  }

  return { start, stop, publish, subscribe, onDisconnect }
}

const defaultBus = createServerEventBus()

export const startServerEventBus = (): Promise<boolean> => defaultBus.start()
export const stopServerEventBus = (): Promise<void> => defaultBus.stop()
export const subscribeServerEvent = (channel: string, handler: EventHandler): (() => void) =>
  defaultBus.subscribe(channel, handler)
export const onServerEventBusDisconnect = (handler: DisconnectHandler): (() => void) =>
  defaultBus.onDisconnect(handler)
export const publishServerEvent = (
  kind: ServerEventKind,
  channel: string,
  payload: unknown,
): Promise<boolean> => defaultBus.publish(kind, channel, payload)

export const publishReportJob = (job: ReportEventPayload): Promise<boolean> =>
  publishServerEvent('report-job', REPORT_EVENT_CHANNEL, job)
export const publishNotification = (notification: NotificationEventPayload): Promise<boolean> =>
  publishServerEvent('notification', NOTIFICATION_EVENT_CHANNEL, notification)

export const subscribeReportJob = (
  reportJobId: string,
  handler: (job: ReportEventPayload) => void,
): (() => void) =>
  subscribeServerEvent(REPORT_EVENT_CHANNEL, (payload) => {
    if (isReportPayload(payload) && payload.report_job_id === reportJobId) handler(payload)
  })

export const subscribeNotification = (
  auth0Id: string,
  handler: (notification: NotificationEventPayload) => void,
): (() => void) =>
  subscribeServerEvent(NOTIFICATION_EVENT_CHANNEL, (payload) => {
    if (isNotificationPayload(payload) && payload.auth0_id === auth0Id) handler(payload)
  })
