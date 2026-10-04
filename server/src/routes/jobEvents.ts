import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import { needsPersistedOwnerBackstop, verifyJobAccess } from '../lib/jobAccess'
import { getAnalysisByServerJobId } from '../lib/analyses'
import { logger } from '../lib/logger'
import {
  onJobEvent,
  onJobEventBusDisconnect,
  startJobEventBus,
  type JobEvent,
} from '../lib/jobEvents'
import {
  resolveStatus,
  statusResponse,
  type StatusResolution,
  type StatusRouteDeps,
} from './status'

type ResolveStatus = (
  request: Request,
  jobId: string,
  deps?: StatusRouteDeps,
) => Promise<StatusResolution>

export type JobEventsDeps = {
  getJob?: typeof getJob
  /** Owner backstop for a live job whose Redis owner set is empty. */
  getAnalysisByServerJobId?: typeof getAnalysisByServerJobId
  resolveStatus?: ResolveStatus
  startBus?: typeof startJobEventBus
  onEvent?: typeof onJobEvent
  onBusDisconnect?: typeof onJobEventBusDisconnect
}

const eventHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}
const EVENT_RESOLVE_TIMEOUT_MS = 15_000

async function resolveWithDeadline(
  resolve: ResolveStatus,
  request: Request,
  jobId: string,
): Promise<StatusResolution> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      resolve(request, jobId),
      new Promise<StatusResolution>((resolveResult) => {
        timer = setTimeout(
          () =>
            resolveResult({
              ok: false,
              status: 503,
              body: buildError(
                'ENGINE_UNAVAILABLE',
                'Analysis status is temporarily unavailable.',
                true,
              ),
            }),
          EVENT_RESOLVE_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const jobEventsRoute = (deps: JobEventsDeps = {}) => {
  const loadJob = deps.getJob ?? getJob
  const resolve = deps.resolveStatus ?? resolveStatus
  const startBus = deps.startBus ?? startJobEventBus
  const subscribe = deps.onEvent ?? onJobEvent
  const subscribeToDisconnect = deps.onBusDisconnect ?? onJobEventBusDisconnect

  return new Elysia({ name: 'job-events' }).get(
    '/api/job-events/:jobId',
    async ({ params, request, set }) => {
      const jobId = params.jobId
      const serverJob = await loadJob(jobId)

      // A persisted terminal job has no live engine stream to subscribe to;
      // reconcile it once and close after the snapshot.
      if (!serverJob) {
        const snapshot = await resolveWithDeadline(resolve, request, jobId)
        if (!snapshot.ok) {
          set.status = snapshot.status
          return snapshot.body
        }
        const body = JSON.stringify({ type: 'snapshot', status: snapshot.response })
        return new Response(`data: ${body}\n\n`, { headers: eventHeaders })
      }

      // Same backstop as status/download/chat. An empty owner set reads as an
      // anonymous demo job, and this is the stream that narrates the analysis, so
      // without the persisted row a stranger holding the id would receive the whole
      // progression live.
      const backstop = needsPersistedOwnerBackstop(serverJob)
        ? await (deps.getAnalysisByServerJobId ?? getAnalysisByServerJobId)(jobId)
        : null
      const access = verifyJobAccess(request, serverJob, backstop)
      if (!access.ok) {
        set.status = access.status
        return access.body
      }

      const busAvailable = await startBus()
      if (!busAvailable) {
        set.status = 503
        return buildError(
          'EVENT_STREAM_UNAVAILABLE',
          'Live status updates are temporarily unavailable.',
          true,
        )
      }

      // Subscribe before the snapshot so an update racing the initial read is
      // buffered rather than lost. The durable status key remains authoritative
      // for reconnects.
      // The engine publishes by engine_job_id, while the browser-facing URL
      // and server_job_id namespace use the server id. Subscribe to the engine
      // namespace; keep all reconciliation/response ids server-scoped.
      const eventJobId = serverJob.engine_job_id
      const buffered: JobEvent[] = []
      let ready = false
      let busDisconnected = false
      let requestAborted = request.signal.aborted
      let closeStream = () => {}
      let unsubscribe = () => {}
      const onRequestAbort = () => {
        requestAborted = true
        closeStream()
      }
      request.signal.addEventListener('abort', onRequestAbort, { once: true })
      const unsubscribeDisconnect = subscribeToDisconnect(() => {
        busDisconnected = true
        closeStream()
      })
      unsubscribe = subscribe(eventJobId, (event) => {
        if (!ready) buffered.push(event)
        else void emitEvent(event)
      })

      let initial: Awaited<ReturnType<typeof resolveWithDeadline>>
      try {
        initial = await resolveWithDeadline(resolve, request, jobId)
      } catch (error) {
        unsubscribe()
        unsubscribeDisconnect()
        request.signal.removeEventListener('abort', onRequestAbort)
        throw error
      }
      if (!initial.ok) {
        unsubscribe()
        unsubscribeDisconnect()
        request.signal.removeEventListener('abort', onRequestAbort)
        set.status = initial.status
        return initial.body
      }
      if (requestAborted) {
        unsubscribe()
        unsubscribeDisconnect()
        request.signal.removeEventListener('abort', onRequestAbort)
        return new Response(null, { status: 499 })
      }
      if (busDisconnected) {
        unsubscribe()
        unsubscribeDisconnect()
        request.signal.removeEventListener('abort', onRequestAbort)
        set.status = 503
        return buildError(
          'EVENT_STREAM_UNAVAILABLE',
          'Live status updates are temporarily unavailable.',
          true,
        )
      }

      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let sequence = Promise.resolve()

      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe()
        unsubscribeDisconnect()
        request.signal.removeEventListener('abort', onRequestAbort)
        try {
          controllerRef?.close()
        } catch {
          // The browser may have already closed the response.
        }
      }

      closeStream = close

      const send = (payload: unknown) => {
        if (closed || !controllerRef) return
        try {
          controllerRef.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          close()
        }
      }

      const emitEvent = (event: JobEvent) => {
        sequence = sequence
          .then(async () => {
            if (closed) return
            // Progress events never carry a summary. Terminal events go back
            // through resolveStatus so persistence and medical redaction stay
            // identical to the one-shot status route.
            if (!event.status.complete) {
              send({
                type: 'progress',
                status: statusResponse(jobId, {
                  ...event.status,
                  summary: null,
                  video_ready: false,
                }),
              })
              return
            }

            const terminal = await resolveWithDeadline(resolve, request, jobId)
            if (!terminal.ok) {
              // The engine acknowledged a terminal event but the status
              // resolver is temporarily unavailable; close so the client can
              // perform one bounded reconciliation instead of hanging on a
              // heartbeat forever.
              close()
              return
            }
            send({ type: 'status', status: terminal.response })
            close()
          })
          .catch((error: unknown) => {
            logger.error('job_event_stream_error', {
              type: 'job_event_stream_error',
              job_id: jobId,
              error: error instanceof Error ? error.message : String(error),
            })
            close()
          })
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller
          send({ type: 'snapshot', status: initial.response })
          ready = true
          for (const event of buffered) void emitEvent(event)
          if (initial.response.complete) {
            close()
            return
          }

          heartbeat = setInterval(() => {
            if (closed || !controllerRef) return
            try {
              controllerRef.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`),
              )
            } catch {
              close()
            }
          }, 30_000)
        },
        cancel() {
          close()
        },
      })

      return new Response(stream, { headers: eventHeaders })
    },
  )
}

export default jobEventsRoute()
