import { isTransientError, toCoachAIError } from '@/lib/errors'
import type { CoachAIError } from '@/types'

// ── Job Polling Engine ──────────────────────────────────────────────────────
// The bounded fallback loop used when a live job-event stream is unavailable.
// The normal analysis path subscribes to /api/job-events/:jobId and never
// enters this loop. One implementation drives interval, exponential backoff,
// an optional hard timeout/request budget, and an optional "stuck" warning —
// with the clock, fetcher, and completion predicate injected so the loop is
// deterministic and testable.
//
// Callers stay declarative: they describe what the poll should do and react to
// onStatus / onComplete / onTransient / onError / onWarn instead of
// re-implementing interval + retry + cancellation logic.

export type PollFailure = {
  kind: 'transient' | 'permanent' | 'timeout'
  error: CoachAIError
  /** Consecutive failed attempts when the failure occurred (0 on success paths). */
  attempts: number
  /** True once at least one status fetch has succeeded before this failure. */
  hadSucceeded: boolean
}

export interface JobPollingConfig<S> {
  jobId: string
  fetchStatus: (jobId: string) => Promise<S>
  isComplete: (status: S) => boolean
  intervalMs?: number
  /** Hard deadline; after it elapses an onError({ kind: 'timeout' }) fires. Undefined = never. */
  timeoutMs?: number
  /** Warn (once) once this much time elapses while the job is still running. Undefined = never. */
  warnAfterMs?: number
  /** Consecutive failures allowed before giving up (default 5). */
  maxFailures?: number
  /** Hard total request budget, including successful nonterminal responses. */
  maxRequests?: number
  /** Interval multiplier per consecutive failure (default 2). Pass 1 for fixed-interval retries. */
  backoffFactor?: number
  maxBackoffMs?: number
  /** Give up on the very first error instead of retrying (default false). */
  giveUpOnFirstFailure?: boolean
  /** Injectable clock for deterministic tests (default Date.now). */
  now?: () => number
  onStatus?: (status: S) => void
  onComplete?: (status: S) => void
  onTransient?: (failure: PollFailure) => void
  onError?: (failure: PollFailure) => void
  onWarn?: () => void
}

export interface JobPollingController {
  stop: () => void
  /** Immediately poll again and reset the timeout/warn clocks (used by manual refresh). */
  refresh: () => void
}

const TIMEOUT_ERROR: CoachAIError = {
  code: 'ANALYSIS_TIMEOUT',
  message: 'Analysis is taking longer than expected. The job may still complete.',
  layer: 'client',
  retryable: false,
}

const REQUEST_BUDGET_ERROR: CoachAIError = {
  code: 'STATUS_RECONCILIATION_EXHAUSTED',
  message: 'Live status updates are unavailable. Refresh to try again.',
  layer: 'client',
  retryable: false,
}

export function startJobPolling<S>(config: JobPollingConfig<S>): JobPollingController {
  const {
    jobId,
    fetchStatus,
    isComplete,
    intervalMs = 2000,
    timeoutMs,
    warnAfterMs,
    maxFailures = 5,
    maxRequests,
    backoffFactor = 2,
    maxBackoffMs = 30_000,
    giveUpOnFirstFailure = false,
    now = Date.now,
    onStatus,
    onComplete,
    onTransient,
    onError,
    onWarn,
  } = config

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let startedAt = now()
  let failures = 0
  let requests = 0
  let generation = 0
  let hadSucceeded = false
  let warned = false

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(failureCount: number) {
    clearTimer()
    const delay =
      failureCount === 0
        ? intervalMs
        : Math.min(intervalMs * Math.pow(backoffFactor, failureCount - 1), maxBackoffMs)
    const scheduledGeneration = generation
    timer = setTimeout(() => {
      if (scheduledGeneration !== generation) return
      timer = null
      void run()
    }, delay)
  }

  function fail(kind: 'permanent' | 'timeout', error: CoachAIError) {
    stopped = true
    clearTimer()
    onError?.({ kind, error, attempts: failures, hadSucceeded })
  }

  async function run() {
    if (stopped) return
    const runGeneration = generation

    const elapsed = now() - startedAt
    if (timeoutMs !== undefined && elapsed > timeoutMs) {
      fail('timeout', TIMEOUT_ERROR)
      return
    }

    if (maxRequests !== undefined && requests >= maxRequests) {
      fail('timeout', REQUEST_BUDGET_ERROR)
      return
    }
    requests += 1

    let status: S
    try {
      status = await fetchStatus(jobId)
    } catch (err) {
      if (stopped || runGeneration !== generation) return
      failures++
      const error = toCoachAIError(err)

      if (giveUpOnFirstFailure || !isTransientError(err) || failures >= maxFailures) {
        fail('permanent', error)
        return
      }

      onTransient?.({ kind: 'transient', error, attempts: failures, hadSucceeded })
      schedule(failures)
      return
    }

    if (stopped || runGeneration !== generation) return
    hadSucceeded = true
    failures = 0
    onStatus?.(status)

    if (isComplete(status)) {
      // Terminal — end the loop. Completion is a success, not an error.
      stop()
      onComplete?.(status)
      return
    }

    if (maxRequests !== undefined && requests >= maxRequests) {
      fail('timeout', REQUEST_BUDGET_ERROR)
      return
    }

    if (warnAfterMs !== undefined && !warned && elapsed > warnAfterMs) {
      warned = true
      onWarn?.()
    }

    schedule(0)
  }

  function stop() {
    stopped = true
    clearTimer()
  }

  function refresh() {
    clearTimer()
    generation += 1
    startedAt = now()
    failures = 0
    requests = 0
    warned = false
    void run()
  }

  void run()
  return { stop, refresh }
}
