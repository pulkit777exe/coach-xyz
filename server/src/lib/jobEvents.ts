// ── Analysis job event bus ───────────────────────────────────────────────────
// The engine publishes a compact public status snapshot whenever it writes a
// job key. One dedicated Redis subscriber fans those events out to the
// authenticated SSE route. The Redis job key remains the source of truth;
// pub/sub is only the wake-up path, so a reconnecting client can reconcile from
// a fresh snapshot without replaying an event history.

import type { Redis as IORedis } from 'ioredis'

import { getRedisConnectionUrl, isLocalRedis } from './redis'
import { logger } from './logger'

export const JOB_EVENT_CHANNEL = 'coachai:job-events'

export type JobEventStatus = {
  state: string
  stage: number
  stage_name: string
  progress: number
  complete: boolean
  summary: unknown
  error: string | null
  error_code: string | null
  retryable: boolean
}

export type JobEvent = {
  job_id: string
  status: JobEventStatus
}

export type JobEventListener = (event: JobEvent) => void

let subscriber: IORedis | null = null
let startPromise: Promise<boolean> | null = null
const listeners = new Map<string, Set<JobEventListener>>()

function parseJobEvent(raw: string): JobEvent | null {
  try {
    const parsed = JSON.parse(raw) as { job_id?: unknown; status?: unknown }
    if (typeof parsed.job_id !== 'string' || !parsed.status || typeof parsed.status !== 'object') {
      return null
    }
    return parsed as JobEvent
  } catch {
    return null
  }
}

function dispatch(event: JobEvent): void {
  const handlers = listeners.get(event.job_id)
  if (!handlers) return
  for (const handler of [...handlers]) {
    try {
      handler(event)
    } catch (error) {
      logger.error('job_event_listener_error', {
        type: 'job_event_listener_error',
        job_id: event.job_id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Start the dedicated Redis subscriber. The function is lazy and safe to call
 * from a request: a no-Redis development posture returns false, allowing the
 * caller to use one-shot status reconciliation instead of opening a dead SSE
 * connection.
 */
export function startJobEventBus(): Promise<boolean> {
  if (subscriber) return Promise.resolve(true)
  if (startPromise) return startPromise

  const url = getRedisConnectionUrl()
  if (!url) {
    logger.warn('job_event_bus_unavailable', {
      type: 'job_event_bus_unavailable',
      detail: 'Redis is not configured; analysis events are disabled',
    })
    return Promise.resolve(false)
  }

  startPromise = (async () => {
    try {
      const IORedisCtor = require('ioredis') as typeof import('ioredis').default
      const client: IORedis = new IORedisCtor(url, {
        maxRetriesPerRequest: null,
        ...(isLocalRedis() ? {} : { tls: {} }),
        enableReadyCheck: false,
        connectTimeout: 5000,
        retryStrategy(times: number) {
          if (times > 10) return null
          return Math.min(times * 500, 5000)
        },
      })
      client.on('error', (error: Error) => {
        logger.error('job_event_redis_error', {
          type: 'job_event_redis_error',
          error: error.message,
        })
      })
      client.on('reconnecting', (delay: number) => {
        logger.warn('job_event_redis_reconnecting', {
          type: 'job_event_redis_reconnecting',
          delay_ms: delay,
        })
      })
      client.on('message', (channel: string, message: string) => {
        if (channel !== JOB_EVENT_CHANNEL) return
        const event = parseJobEvent(message)
        if (event) dispatch(event)
      })
      await client.subscribe(JOB_EVENT_CHANNEL)
      subscriber = client
      return true
    } catch (error) {
      logger.error('job_event_bus_start_failed', {
        type: 'job_event_bus_start_failed',
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      startPromise = null
    }
  })()

  return startPromise
}

/** Stop the subscriber and detach all in-process listeners. */
export async function stopJobEventBus(): Promise<void> {
  const client = subscriber
  subscriber = null
  listeners.clear()
  if (!client) return
  try {
    await client.quit()
  } catch (error) {
    logger.warn('job_event_bus_stop_error', {
      type: 'job_event_bus_stop_error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Subscribe to one job's compact status events. */
export function onJobEvent(jobId: string, listener: JobEventListener): () => void {
  void startJobEventBus()
  const handlers = listeners.get(jobId) ?? new Set<JobEventListener>()
  handlers.add(listener)
  listeners.set(jobId, handlers)
  return () => {
    const current = listeners.get(jobId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(jobId)
  }
}
