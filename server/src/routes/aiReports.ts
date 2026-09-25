// ── AI report routes ────────────────────────────────────────────────────────
// Guarded endpoints for one-click AI report generation:
//   POST /api/org/:auth0Id/reports/ai        — validate, build context, enqueue
//   GET  /api/org/:auth0Id/reports/ai/:id    — poll status + report when done
// The engine call runs in the BullMQ coachai-report worker (queue.ts). Deps
// are injectable so tests stay DB/Redis-free.

import { Elysia } from 'elysia'
import { buildError } from '../lib/errors'
import type { CoachAIError } from '../types'
import { serviceGuard } from '../lib/serviceGuard'
import { checkAiReportLimit, rateLimited } from '../lib/ratelimit'
import { REPORT_TYPES } from '../lib/orgEnums'
import type { ReportType } from '../lib/orgEnums'
import { isDate, defaultReportTitle } from '../lib/orgValidate'
import { buildReportContent, getAiReportJob, subscribeAiReportJob } from '../lib/aiReportData'
import type { AiReportJob } from '../lib/aiReportData'
import { getReport } from '../lib/orgData'
import type { ReportRecord } from '../lib/orgData'
import { enqueueAiReport } from '../lib/queue'
import type { AiReportPayload } from '../lib/queue'
import { logger } from '../lib/logger'
import { onServerEventBusDisconnect, startServerEventBus } from '../lib/serverEvents'

const REPORT_TYPE_SET: ReadonlySet<string> = new Set(REPORT_TYPES)
const REPORT_EVENT_LOOKUP_TIMEOUT_MS = 10_000
// A lost cross-replica event must not leave a browser on heartbeats forever.
// Closing after a bounded lifetime makes the client perform its single
// one-shot status reconciliation and surface a retryable error if still running.
const REPORT_EVENT_MAX_DURATION_MS = 5 * 60 * 1000

async function withReportLookupTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Report lookup timed out while streaming the job event.')),
          REPORT_EVENT_LOOKUP_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type AiReportRequest = {
  student_id?: string | null
  report_type: ReportType
  period_start?: string | null
  period_end?: string | null
  title?: string | null
}

export function validateAiReportBody(
  body: unknown,
): { ok: true; value: AiReportRequest } | { ok: false; error: CoachAIError } {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'Body must be a JSON object', false),
    }
  }
  const b = body as Record<string, unknown>

  const reportType = typeof b.report_type === 'string' ? b.report_type : ''
  if (!reportType || !REPORT_TYPE_SET.has(reportType)) {
    return {
      ok: false,
      error: buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${REPORT_TYPES.join(', ')}`,
        false,
      ),
    }
  }
  if (
    b.student_id !== undefined &&
    (typeof b.student_id !== 'string' || !(b.student_id as string).trim())
  ) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'student_id must be a non-empty string', false),
    }
  }
  if (b.period_start !== undefined && b.period_start !== null && !isDate(b.period_start)) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false),
    }
  }
  if (b.period_end !== undefined && b.period_end !== null && !isDate(b.period_end)) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false),
    }
  }
  if (
    b.title !== undefined &&
    b.title !== null &&
    (typeof b.title !== 'string' || !(b.title as string).trim())
  ) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'title must be a non-empty string', false),
    }
  }

  return {
    ok: true,
    value: {
      student_id:
        typeof b.student_id === 'string' && (b.student_id as string).trim()
          ? (b.student_id as string).trim()
          : null,
      report_type: reportType as ReportType,
      period_start: isDate(b.period_start) ? (b.period_start as string) : null,
      period_end: isDate(b.period_end) ? (b.period_end as string) : null,
      title:
        typeof b.title === 'string' && (b.title as string).trim()
          ? (b.title as string).trim()
          : null,
    },
  }
}

type GetReportById = (
  auth0Id: string,
  id: string,
) => Promise<(ReportRecord & { full_name: string | null }) | null>

export type AiReportsDeps = {
  buildContext?: typeof buildReportContent
  enqueue?: (payload: Omit<AiReportPayload, 'report_job_id'>) => Promise<string | null>
  getJob?: (reportJobId: string) => Promise<AiReportJob | null>
  getReportById?: GetReportById
  subscribeJob?: typeof subscribeAiReportJob
  startBus?: typeof startServerEventBus
  onBusDisconnect?: typeof onServerEventBusDisconnect
}

export const aiReportsRoute = (deps: AiReportsDeps = {}) => {
  const buildContext = deps.buildContext ?? buildReportContent
  const enqueue = deps.enqueue ?? enqueueAiReport
  const getJob = deps.getJob ?? getAiReportJob
  const fetchReport = deps.getReportById ?? getReport
  const subscribeJob = deps.subscribeJob ?? subscribeAiReportJob
  const startBus = deps.startBus ?? startServerEventBus
  const subscribeToDisconnect = deps.onBusDisconnect ?? onServerEventBusDisconnect

  return new Elysia({ name: 'aiReports' })
    .use(serviceGuard)
    .post('/api/org/:auth0Id/reports/ai', async ({ params, body, set }) => {
      const { auth0Id } = params as { auth0Id: string }
      if (!auth0Id) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
      }
      const { allowed } = await checkAiReportLimit(auth0Id)
      if (!allowed) {
        return rateLimited(set, 'Hourly AI report limit reached for this organization.')
      }

      const validated = validateAiReportBody(body)
      if (!validated.ok) {
        set.status = 400
        return validated.error
      }
      const value = validated.value

      const context = await buildContext(auth0Id, {
        student_id: value.student_id ?? undefined,
        from: value.period_start ?? undefined,
        to: value.period_end ?? undefined,
        report_type: value.report_type,
      })

      const studentBlock =
        context.student && typeof context.student === 'object'
          ? (context.student as Record<string, unknown>)
          : null
      const sport = typeof studentBlock?.sport === 'string' ? (studentBlock.sport as string) : null
      const studentName =
        typeof studentBlock?.full_name === 'string' ? (studentBlock.full_name as string) : null

      const title =
        value.title ??
        defaultReportTitle(value.report_type, studentName ? { full_name: studentName } : null)

      const reportJobId = await enqueue({
        auth0_id: auth0Id,
        report_type: value.report_type,
        period_start: value.period_start,
        period_end: value.period_end,
        title,
        student_id: value.student_id ?? null,
        sport,
        student_name: studentName,
        report_context: context,
      })

      if (!reportJobId) {
        set.status = 503
        return buildError(
          'QUEUE_UNAVAILABLE',
          'Job queue is not configured. Please try again later.',
          true,
        )
      }

      set.status = 201
      return { report_job_id: reportJobId, status: 'queued' }
    })
    .get('/api/org/:auth0Id/reports/ai/:reportJobId/events', async ({ params, request, set }) => {
      const { auth0Id, reportJobId } = params as {
        auth0Id: string
        reportJobId: string
      }
      if (!auth0Id || !reportJobId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id or reportJobId parameter', false)
      }

      const initialForAuth = await getJob(reportJobId)
      if (!initialForAuth || initialForAuth.auth0_id !== auth0Id) {
        set.status = 404
        return buildError('NOT_FOUND', 'Report job not found', false)
      }

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
          'REPORT_EVENT_STREAM_UNAVAILABLE',
          'Live report updates are temporarily unavailable.',
          true,
        )
      }

      // Subscribe before taking the snapshot used by the stream. The durable
      // record is still the source of truth, but a transition racing this
      // read is retained in `latest` instead of being lost.
      let latest: AiReportJob | null = null
      let activeListener: ((job: AiReportJob) => void) | null = null
      const unsubscribe = subscribeJob(reportJobId, (job) => {
        latest = job
        activeListener?.(job)
      })
      let snapshot: AiReportJob | null
      try {
        snapshot = await getJob(reportJobId)
      } catch (error) {
        unsubscribe()
        unsubscribeDisconnect()
        throw error
      }
      if (!snapshot || snapshot.auth0_id !== auth0Id) {
        unsubscribe()
        unsubscribeDisconnect()
        set.status = 404
        return buildError('NOT_FOUND', 'Report job not found', false)
      }
      if (busDisconnected) {
        unsubscribe()
        unsubscribeDisconnect()
        set.status = 503
        return buildError(
          'REPORT_EVENT_STREAM_UNAVAILABLE',
          'Live report updates are temporarily unavailable.',
          true,
        )
      }
      const latestJob = latest as AiReportJob | null
      const initial =
        latestJob && latestJob.updated_at >= snapshot.updated_at ? latestJob : snapshot
      if (request.signal.aborted) {
        unsubscribe()
        unsubscribeDisconnect()
        return new Response(null, { status: 499 })
      }

      let cancelStream = () => {}
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          let closed = false
          let heartbeat: ReturnType<typeof setInterval> | null = null
          let maxDurationTimer: ReturnType<typeof setTimeout> | null = null
          let sequence = Promise.resolve()

          const close = () => {
            if (closed) return
            closed = true
            if (heartbeat) clearInterval(heartbeat)
            if (maxDurationTimer) clearTimeout(maxDurationTimer)
            activeListener = null
            unsubscribe()
            unsubscribeDisconnect()
            try {
              controller.close()
            } catch {
              // The client may already have closed the stream.
            }
          }

          closeStream = close
          cancelStream = close

          const enqueue = (job: AiReportJob) => {
            sequence = sequence
              .then(async () => {
                if (closed) return
                const report =
                  job.status === 'done' && job.report_id
                    ? await withReportLookupTimeout(fetchReport(auth0Id, job.report_id))
                    : null
                if (closed) return
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      report_job_id: job.report_job_id,
                      status: job.status,
                      report,
                    })}\n\n`,
                  ),
                )
                if (job.status === 'done' || job.status === 'failed') close()
              })
              .catch((error: unknown) => {
                logger.error('ai_report_event_stream_error', {
                  type: 'ai_report_event_stream_error',
                  report_job_id: reportJobId,
                  error: error instanceof Error ? error.message : String(error),
                })
                close()
              })
          }

          activeListener = enqueue
          enqueue(initial)
          // Cover the tiny gap between snapshot selection and listener
          // assignment without replaying the same record twice.
          if (latest && latest.updated_at > initial.updated_at) enqueue(latest)
          heartbeat = setInterval(() => {
            if (closed) return
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`),
              )
            } catch {
              close()
            }
          }, 30_000)
          maxDurationTimer = setTimeout(close, REPORT_EVENT_MAX_DURATION_MS)
          maxDurationTimer.unref?.()
          request.signal.addEventListener('abort', close, { once: true })
        },
        cancel() {
          cancelStream()
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
    .get('/api/org/:auth0Id/reports/ai/:reportJobId', async ({ params, set }) => {
      const { auth0Id, reportJobId } = params as {
        auth0Id: string
        reportJobId: string
      }
      if (!auth0Id || !reportJobId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id or reportJobId parameter', false)
      }

      const job = await getJob(reportJobId)
      // Same 404 for missing and cross-org ids so account boundaries don't leak.
      if (!job || job.auth0_id !== auth0Id) {
        set.status = 404
        return buildError('NOT_FOUND', 'Report job not found', false)
      }

      if (job.status === 'done' && job.report_id) {
        const report = await fetchReport(auth0Id, job.report_id)
        set.status = 200
        return {
          report_job_id: job.report_job_id,
          status: job.status,
          report,
        }
      }

      set.status = 200
      return {
        report_job_id: job.report_job_id,
        status: job.status,
        report: null,
      }
    })
}

export default aiReportsRoute()
