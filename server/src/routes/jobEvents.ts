import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import { verifyJobAccess } from '../lib/jobAccess'
import { logger } from '../lib/logger'
import { onJobEvent, startJobEventBus, type JobEvent } from '../lib/jobEvents'
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
  resolveStatus?: ResolveStatus
  startBus?: typeof startJobEventBus
  onEvent?: typeof onJobEvent
}

const eventHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

export const jobEventsRoute = (deps: JobEventsDeps = {}) => {
  const loadJob = deps.getJob ?? getJob
  const resolve = deps.resolveStatus ?? resolveStatus
  const startBus = deps.startBus ?? startJobEventBus
  const subscribe = deps.onEvent ?? onJobEvent

  return new Elysia({ name: 'job-events' }).get(
    '/api/job-events/:jobId',
    async ({ params, request, set }) => {
      const jobId = params.jobId
      const serverJob = await loadJob(jobId)

      // A persisted terminal job has no live engine stream to subscribe to;
      // reconcile it once and close after the snapshot.
      if (!serverJob) {
        const snapshot = await resolve(request, jobId)
        if (!snapshot.ok) {
          set.status = snapshot.status
          return snapshot.body
        }
        const body = JSON.stringify({ type: 'snapshot', status: snapshot.response })
        return new Response(`data: ${body}\n\n`, { headers: eventHeaders })
      }

      const access = verifyJobAccess(request, serverJob)
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
      let unsubscribe = () => {}
      unsubscribe = subscribe(eventJobId, (event) => {
        if (!ready) buffered.push(event)
        else void emitEvent(event)
      })

      const initial = await resolve(request, jobId)
      if (!initial.ok) {
        unsubscribe()
        set.status = initial.status
        return initial.body
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
        try {
          controllerRef?.close()
        } catch {
          // The browser may have already closed the response.
        }
      }

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

            const terminal = await resolve(request, jobId)
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
          request.signal.addEventListener('abort', close, { once: true })
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
