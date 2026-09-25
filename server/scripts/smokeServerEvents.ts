// Live two-replica smoke for the shared report/notification Redis bus.
//
//   cd server && bun run smoke:server-events
//
// This uses two independent bus instances against the configured Redis, so a
// pass proves cross-process event delivery rather than only local EventEmitter
// behavior. It skips cleanly when Redis is not configured (CI).

import {
  createServerEventBus,
  NOTIFICATION_EVENT_CHANNEL,
  REPORT_EVENT_CHANNEL,
} from '../src/lib/serverEvents'

const tag = `smoke-server-events-${Math.random().toString(36).slice(2, 8)}`

function waitForMessage<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function main(): Promise<void> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.log(JSON.stringify({ tag, skipped: true, reason: 'Redis is not configured' }))
    return
  }

  const busA = createServerEventBus({ origin: `${tag}-a` })
  const busB = createServerEventBus({ origin: `${tag}-b` })
  const report = {
    report_job_id: `${tag}-report`,
    auth0_id: 'smoke|no-account',
    status: 'running' as const,
    report_id: null,
    error: null,
    progress: 45,
    created_at: Date.now(),
    updated_at: Date.now(),
  }
  const notification = {
    id: `${tag}-notification`,
    auth0_id: 'smoke|no-account',
    type: 'report_ready',
    title: 'Report ready',
    body: null,
    data: {},
    read: false,
    created_at: new Date().toISOString(),
  }

  try {
    if (!(await busA.start()) || !(await busB.start())) {
      throw new Error('Could not start both shared event bus replicas')
    }

    let resolveReport: (value: unknown) => void = () => {}
    const reportMessage = new Promise<unknown>((resolve) => {
      resolveReport = resolve
    })
    const stopReport = busB.subscribe(REPORT_EVENT_CHANNEL, (payload) => resolveReport(payload))

    let resolveNotification: (value: unknown) => void = () => {}
    const notificationMessage = new Promise<unknown>((resolve) => {
      resolveNotification = resolve
    })
    const stopNotification = busA.subscribe(NOTIFICATION_EVENT_CHANNEL, (payload) =>
      resolveNotification(payload),
    )

    if (!(await busA.publish('report-job', REPORT_EVENT_CHANNEL, report))) {
      throw new Error('Report event was not published to Redis')
    }
    if ((await waitForMessage(reportMessage))?.report_job_id !== report.report_job_id) {
      throw new Error('Replica B did not receive the report event')
    }

    if (!(await busB.publish('notification', NOTIFICATION_EVENT_CHANNEL, notification))) {
      throw new Error('Notification event was not published to Redis')
    }
    if ((await waitForMessage(notificationMessage))?.id !== notification.id) {
      throw new Error('Replica A did not receive the notification event')
    }

    stopReport()
    stopNotification()
    console.log(JSON.stringify({ tag, passed: 2, failed: 0, redisConfigured: true }))
  } finally {
    await busA.stop()
    await busB.stop()
  }
}

await main()
// Standalone smoke scripts own the process; avoid waiting on client-library
// sockets after all assertions and cleanup have completed.
process.exit(process.exitCode ?? 0)
