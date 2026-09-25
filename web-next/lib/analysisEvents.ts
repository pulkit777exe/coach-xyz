import { getAttributionToken } from './api'
import { errorFromResponse, toCoachAIError } from './errors'
import { parseEventStream } from './sse'
import { startJobPolling, type JobPollingController, type PollFailure } from './jobPolling'
import type { JobStatus } from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

type AnalysisEvent = {
  type: 'snapshot' | 'progress' | 'status'
  status: JobStatus
}

type EventFailureHandler = (error: unknown) => void

/**
 * Open the authoritative analysis event stream. A single connection receives a
 * snapshot followed by progress/terminal events; it never polls. The caller
 * decides whether a one-shot/bounded fallback is appropriate.
 */
export function subscribeAnalysisEvents(
  jobId: string,
  onStatus: (status: JobStatus) => void,
  onFailure: EventFailureHandler,
  signal: AbortSignal,
): () => void {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  void (async () => {
    try {
      if (!API_BASE) throw new Error('Analysis event stream is not configured.')
      const attribution = await getAttributionToken().catch(() => null)
      const response = await fetch(`${API_BASE}/api/job-events/${encodeURIComponent(jobId)}`, {
        signal: controller.signal,
        headers: {
          'x-request-id': crypto.randomUUID(),
          ...(attribution ? { 'x-attribution': attribution } : {}),
        },
      })
      if (!response.ok) {
        throw errorFromResponse(response.status, await response.json().catch(() => ({})), {
          code: 'EVENT_STREAM_UNAVAILABLE',
          message: 'Live status updates are temporarily unavailable.',
        })
      }
      if (!response.body) throw new Error('Analysis event stream returned no body.')

      for await (const event of parseEventStream<AnalysisEvent>(response)) {
        if (controller.signal.aborted) return
        if (!event || typeof event !== 'object' || !event.status) continue
        onStatus(event.status)
        if (event.status.complete) return
      }
      if (!controller.signal.aborted) {
        throw new Error('Analysis event stream closed before a terminal status.')
      }
    } catch (error) {
      if (!controller.signal.aborted) onFailure(error)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  })()

  return () => {
    signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}

export type AnalysisStatusConfig = {
  jobId: string
  fetchStatus: (jobId: string) => Promise<JobStatus>
  isComplete: (status: JobStatus) => boolean
  timeoutMs?: number
  warnAfterMs?: number
  signal?: AbortSignal
  /** Injectable for deterministic transport tests; production uses SSE. */
  subscribeEvents?: typeof subscribeAnalysisEvents
  onStatus?: (status: JobStatus) => void
  onComplete?: (status: JobStatus) => void
  onTransient?: (failure: PollFailure) => void
  onError?: (failure: PollFailure) => void
  onWarn?: () => void
}

/**
 * Event-first status controller with a deliberately small reconciliation
 * fallback. The normal path is one SSE connection; if it is unavailable or
 * drops, the fallback performs at most four status requests with 5s→10s→20s
 * backoff and the same hard timeout as the analysis workflow.
 */
export function startAnalysisStatus(config: AnalysisStatusConfig): JobPollingController {
  let stopped = false
  let hadSucceeded = false
  let streamCleanup: (() => void) | null = null
  let streamAbort: AbortController | null = null
  let fallback: JobPollingController | null = null
  let warnTimer: ReturnType<typeof setTimeout> | null = null
  const subscribeEvents = config.subscribeEvents ?? subscribeAnalysisEvents

  const clearWarnTimer = () => {
    if (warnTimer) clearTimeout(warnTimer)
    warnTimer = null
  }

  const armWarnTimer = () => {
    clearWarnTimer()
    if (config.warnAfterMs === undefined) return
    warnTimer = setTimeout(() => {
      if (!stopped && !fallback) config.onWarn?.()
    }, config.warnAfterMs)
  }

  const stopStream = () => {
    streamCleanup?.()
    streamCleanup = null
    streamAbort?.abort()
    streamAbort = null
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    stopStream()
    fallback?.stop()
    fallback = null
    clearWarnTimer()
    config.signal?.removeEventListener('abort', stop)
  }

  const handleStatus = (status: JobStatus) => {
    if (stopped) return
    hadSucceeded = true
    armWarnTimer()
    config.onStatus?.(status)
    if (config.isComplete(status)) {
      config.onComplete?.(status)
      stop()
    }
  }

  const startFallback = (reason: unknown) => {
    if (stopped || fallback) return
    stopStream()
    clearWarnTimer()
    const error = toCoachAIError(reason)
    config.onTransient?.({ kind: 'transient', error, attempts: 1, hadSucceeded })
    fallback = startJobPolling({
      jobId: config.jobId,
      fetchStatus: config.fetchStatus,
      isComplete: config.isComplete,
      intervalMs: 5_000,
      timeoutMs: config.timeoutMs ?? 12 * 60 * 1000,
      maxFailures: 4,
      backoffFactor: 2,
      maxBackoffMs: 30_000,
      warnAfterMs: config.warnAfterMs,
      onStatus: (status) => {
        hadSucceeded = true
        config.onStatus?.(status)
      },
      onComplete: (status) => {
        fallback = null
        config.onComplete?.(status)
        stop()
      },
      onTransient: config.onTransient,
      onError: (failure) => {
        fallback = null
        config.onError?.(failure)
        stop()
      },
      onWarn: config.onWarn,
    })
  }

  const startStream = () => {
    if (stopped || fallback) return
    armWarnTimer()
    streamAbort = new AbortController()
    const externalAbort = () => {
      if (streamAbort?.signal.aborted) return
      streamAbort?.abort()
      stop()
    }
    config.signal?.addEventListener('abort', externalAbort, { once: true })
    streamCleanup = subscribeEvents(config.jobId, handleStatus, startFallback, streamAbort.signal)
    const cleanup = streamCleanup
    // The external listener is removed by the controller cleanup below; keep
    // the stream lifecycle owned by this function to avoid leaked listeners.
    streamCleanup = () => {
      config.signal?.removeEventListener('abort', externalAbort)
      cleanup()
    }
    // A test/injected transport may fail synchronously before the assignment
    // above completes; do not leave that already-failed stream attached.
    if (stopped || fallback) stopStream()
  }

  const refresh = () => {
    if (stopped) return
    if (fallback) {
      fallback.refresh()
      return
    }
    stopStream()
    void config
      .fetchStatus(config.jobId)
      .then((status) => {
        if (stopped) return
        if (config.isComplete(status)) {
          handleStatus(status)
          return
        }
        startFallback(new Error('Live status stream was refreshed manually.'))
      })
      .catch((error: unknown) => startFallback(error))
  }

  if (config.signal) {
    if (config.signal.aborted) stop()
    else config.signal.addEventListener('abort', stop, { once: true })
  }
  startStream()

  return { stop, refresh }
}
