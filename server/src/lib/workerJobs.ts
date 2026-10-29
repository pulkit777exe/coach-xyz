// ── Job-kind adapters ────────────────────────────────────────────────────────
// Dependency-injected, side-effect-free on import: no Redis, BullMQ server, or
// Supabase. `workerLifecycle.ts` wires these to real queues/workers; tests
// exercise them with in-memory fakes.
import { UnrecoverableError } from 'bullmq'

import { DEFAULT_MODEL } from '../types'
import type { CoachAIError } from '../types'
import { isCoachAIError, isQueueRetryable, wrapEngineError } from './errors'
import { logEvent } from './log'
import { getEngineJobStatus, markEngineJobFailed, analyzeVideo } from './engine'
import { getJob } from './jobs'
import { persistAnalysisStatus } from './analyses'
import { pruneRetention } from './analysisPolicy'
import {
  generateAiReport,
  persistAiReportRecord,
  updateAiReportJob,
} from './aiReportData'

// ── Names + defaults ─────────────────────────────────────────────────────────

export const ANALYSIS_QUEUE_NAME = 'coachai-analysis'
export const REPORT_QUEUE_NAME = 'coachai-report'

/** attempts:3 / exponential-5s / removeOnComplete:50 / removeOnFail:100 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
} as const

// Job priority (BullMQ: higher number = higher priority)
export const JOB_PRIORITY = 0

/** Stuck recovery: jobs active >13min (1 min buffer over the 12 min engine timeout). */
export const STUCK_TIMEOUT_MS = 13 * 60 * 1000
export const STUCK_SWEEP_INTERVAL_MS = 10 * 60 * 1000
export const STUCK_SWEEP_INITIAL_DELAY_MS = 30_000
/** Retention pruning (§30): daily sweep of analyses past RETENTION_DAYS. */
export const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
export const RETENTION_SWEEP_INITIAL_DELAY_MS = 60_000

export const SHUTDOWN_TIMEOUT_MS = 10_000

export const getAnalysisWorkerConcurrency = (): number =>
  Number(process.env.WORKER_CONCURRENCY) || 1
export const getReportWorkerConcurrency = (): number =>
  Number(process.env.REPORT_WORKER_CONCURRENCY) || 1

// ── Caller-shaped payloads (preserved verbatim) ──────────────────────────────

export interface AnalysisPayload {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  video_key: string | null
  angle?: string | null
  owner_ids?: string[]
  /** BullMQ priority (higher = sooner). Signed-in flows outrank anonymous. */
  priority?: number
}

export interface AiReportPayload {
  report_job_id: string
  auth0_id: string
  report_type: string
  period_start?: string | null
  period_end?: string | null
  title?: string | null
  student_id?: string | null
  sport?: string | null
  student_name?: string | null
  report_context: Record<string, unknown>
}

// ── Retry mapping ────────────────────────────────────────────────────────────

/** Idempotency: skip jobs already in a terminal BullMQ state. */
export function isTerminalJobState(state: string | null | undefined): boolean {
  return state === 'completed' || state === 'failed'
}

/**
 * Retry mapping: the engine owns retryability. Non-retryable errors will
 * never succeed on retry, so callers throw UnrecoverableError to stop BullMQ
 * (attempts: 3) from retrying a doomed job.
 */
export function classifyProcessorError(
  error: unknown,
  fallbackMessage = 'Unknown engine error.',
): { retryable: boolean; code: string; message: string; error: CoachAIError } {
  const engineError = isCoachAIError(error)
    ? error
    : wrapEngineError({
        message: error instanceof Error ? error.message : fallbackMessage,
      })
  return {
    retryable: isQueueRetryable(engineError),
    code: engineError.code,
    message: engineError.message,
    error: engineError,
  }
}

/** Extract the `CODE` prefix from an UnrecoverableError `CODE: message`. */
export function extractUnrecoverableCode(failedReason: string | null | undefined): string | null {
  if (!failedReason) return null
  const match = failedReason.match(/^(\w+):/)
  return match ? match[1] : null
}

/** Mark the engine job failed when retries are exhausted OR the error is unrecoverable. */
export function shouldMarkAnalysisFailed(input: {
  attemptsMade?: number
  attempts?: number
  failedReason?: string | null
}): { mark: boolean; unrecoverable: boolean } {
  const unrecoverable = (input.failedReason ?? '').includes('UnrecoverableError')
  const exhausted = (input.attemptsMade ?? 0) >= (input.attempts ?? 3)
  return { mark: unrecoverable || exhausted, unrecoverable }
}

// ── Processors ───────────────────────────────────────────────────────────────

export interface AnalysisProcessorDeps {
  analyzeVideo: typeof analyzeVideo
  getEngineJobStatus: typeof getEngineJobStatus
  getJob: typeof getJob
  persistAnalysisStatus: typeof persistAnalysisStatus
}

/** Analysis job-kind adapter: idempotency → engine call → completion persist. */
export async function runAnalysisProcessor(
  data: AnalysisPayload,
  getState: () => Promise<string | null | undefined>,
  deps: AnalysisProcessorDeps,
  defaultModel: string = DEFAULT_MODEL,
): Promise<{ ok: boolean; skipped?: string }> {
  if (isTerminalJobState(await getState())) {
    return { ok: true, skipped: 'already_terminal' }
  }

  const { engine_job_id, session_token, player_index, video_key, angle } = data

  try {
    await deps.analyzeVideo(
      { engine_job_id, session_token, player_index, video_key, angle },
      data.server_job_id,
    )
  } catch (error) {
    const mapped = classifyProcessorError(error)
    if (!mapped.retryable) {
      throw new UnrecoverableError(`${mapped.code}: ${mapped.message}`)
    }
    throw mapped.error
  }

  // Persist completed status immediately so history is accurate even if the
  // client never polls again (browser closed, network drop, etc.)
  try {
    const statusResult = await deps.getEngineJobStatus(engine_job_id, data.server_job_id)
    if (statusResult.status === 'found') {
      const engineStatus = statusResult.data
      const serverJob = await deps.getJob(data.server_job_id)
      await deps.persistAnalysisStatus({
        serverJobId: data.server_job_id,
        engineJobId: engine_job_id,
        sessionToken: data.session_token,
        playerIndex: data.player_index,
        model: serverJob?.model ?? defaultModel,
        status: {
          stage: engineStatus.stage ?? 6,
          stage_name: engineStatus.stage_name ?? 'Complete',
          progress: engineStatus.progress ?? 100,
          complete: engineStatus.complete,
          video_ready: engineStatus.video_ready ?? false,
          summary: engineStatus.summary ?? null,
          error: engineStatus.error ?? null,
          error_code: engineStatus.error_code ?? null,
          retryable: engineStatus.retryable ?? false,
        },
      })
    }
  } catch (persistErr) {
    logEvent('error', 'worker_completion_persist_error', {
        engine_job_id,
        error: persistErr instanceof Error ? persistErr.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
  }

  return { ok: true }
}

export interface AiReportProcessorDeps {
  updateAiReportJob: typeof updateAiReportJob
  generateAiReport: typeof generateAiReport
  persistAiReportRecord: typeof persistAiReportRecord
}

/** AI-report job-kind adapter: idempotency → engine /report → persist row. */
export async function runAiReportProcessor(
  data: AiReportPayload,
  getState: () => Promise<string | null | undefined>,
  deps: AiReportProcessorDeps,
): Promise<{ ok: boolean; skipped?: string }> {
  if (isTerminalJobState(await getState())) {
    return { ok: true, skipped: 'already_terminal' }
  }

  const {
    report_job_id,
    auth0_id,
    report_type,
    period_start,
    period_end,
    title,
    student_id,
    sport,
    student_name,
    report_context,
  } = data

  try {
    await deps.updateAiReportJob(report_job_id, { status: 'running', progress: 10 })
    const { report, raw } = await deps.generateAiReport(
      { report_context, report_type, sport, student_name },
      report_job_id,
    )
    const persisted = await deps.persistAiReportRecord({
      auth0_id,
      report_type: report_type as Parameters<typeof persistAiReportRecord>[0]['report_type'],
      title: title ?? 'AI Report',
      period_start: period_start ?? null,
      period_end: period_end ?? null,
      student_id: student_id ?? null,
      report,
      raw,
    })
    await deps.updateAiReportJob(report_job_id, {
      status: 'done',
      progress: 100,
      report_id: persisted.id,
    })
    return { ok: true }
  } catch (error) {
    const mapped = classifyProcessorError(error, 'Unknown AI report error.')

    await deps.updateAiReportJob(report_job_id, {
      status: 'failed',
      error: `${mapped.code}: ${mapped.message}`,
    })

    if (!mapped.retryable) {
      throw new UnrecoverableError(`${mapped.code}: ${mapped.message}`)
    }
    throw mapped.error
  }
}

// ── Terminal-failure handlers ────────────────────────────────────────────────

export interface AnalysisFailureJob {
  attemptsMade?: number
  opts?: { attempts?: number }
  data: AnalysisPayload
}

export interface AnalysisFailureDeps {
  markEngineJobFailed: typeof markEngineJobFailed
  getJob: typeof getJob
  persistAnalysisStatus: typeof persistAnalysisStatus
}

/** Analysis failed-handler adapter: engine fail-mark + Supabase persist. */
export async function handleAnalysisFailure(
  event: { jobId: string; failedReason?: string | null },
  lookup: (jobId: string) => Promise<AnalysisFailureJob | null | undefined>,
  deps: AnalysisFailureDeps,
  defaultModel: string = DEFAULT_MODEL,
): Promise<{ handled: boolean; errorCode?: string; retryable?: boolean }> {
  try {
    const bullJob = await lookup(event.jobId)
    if (!bullJob?.data?.engine_job_id) return { handled: false }

    const { mark, unrecoverable } = shouldMarkAnalysisFailed({
      attemptsMade: bullJob.attemptsMade,
      attempts: bullJob.opts?.attempts,
      failedReason: event.failedReason,
    })
    if (!mark) return { handled: false }

    let errorCode = 'ANALYSIS_FAILED'
    let retryable = true
    if (unrecoverable && event.failedReason) {
      const code = extractUnrecoverableCode(event.failedReason)
      if (code) {
        errorCode = code
        retryable = false
      }
    }

    const failureMessage =
      unrecoverable && event.failedReason
        ? event.failedReason
        : 'Analysis failed after retries. Please try again.'

    await deps.markEngineJobFailed(
      bullJob.data.engine_job_id,
      failureMessage,
      errorCode,
      retryable,
      bullJob.data.server_job_id,
    )

    // Persist failed status to history so it appears even if the client stops polling.
    try {
      const serverJob = await deps.getJob(bullJob.data.server_job_id)
      await deps.persistAnalysisStatus({
        serverJobId: bullJob.data.server_job_id,
        engineJobId: bullJob.data.engine_job_id,
        sessionToken: bullJob.data.session_token,
        playerIndex: bullJob.data.player_index,
        model: serverJob?.model ?? defaultModel,
        status: {
          stage: -1,
          stage_name: 'Failed',
          progress: 0,
          complete: true,
          video_ready: false,
          summary: null,
          error: failureMessage,
          error_code: errorCode,
          retryable,
        },
      })
    } catch (persistErr) {
      logEvent('error', 'failed_persist_history_error', {
        engine_job_id: bullJob.data.engine_job_id,
        error: persistErr instanceof Error ? persistErr.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    }

    logEvent('error', unrecoverable ? 'job_unrecoverable' : 'job_exhausted', {
      engine_job_id: bullJob.data.engine_job_id,
      attempts: bullJob.attemptsMade,
      error_code: errorCode,
    })
    return { handled: true, errorCode, retryable }
  } catch (err) {
    logEvent('error', 'failed_event_handler_error', {
      jobId: event.jobId,
      error: err instanceof Error ? err.message : 'unknown',
      timestamp: new Date().toISOString(),
    })
    return { handled: false }
  }
}

export interface ReportFailureJob {
  attemptsMade?: number
  opts?: { attempts?: number }
  data: { report_job_id?: string }
}

export interface ReportFailureDeps {
  updateAiReportJob: typeof updateAiReportJob
}

/** Report failed-handler adapter: mark the Redis record failed on exhaustion. */
export async function handleReportFailure(
  event: { jobId: string; failedReason?: string | null },
  lookup: (jobId: string) => Promise<ReportFailureJob | null | undefined>,
  deps: ReportFailureDeps,
): Promise<{ handled: boolean }> {
  try {
    const bullJob = await lookup(event.jobId)
    const reportJobId = bullJob?.data?.report_job_id
    if (!reportJobId) return { handled: false }

    const retriesExhausted = (bullJob.attemptsMade ?? 0) >= (bullJob.opts?.attempts ?? 3)
    if (retriesExhausted) {
      await deps.updateAiReportJob(reportJobId, {
        status: 'failed',
        error: event.failedReason ?? 'AI report failed after retries.',
      })
      return { handled: true }
    }
    return { handled: false }
  } catch (err) {
    logEvent('error', 'ai_report_failed_event_error', {
      jobId: event.jobId,
      error: err instanceof Error ? err.message : 'unknown',
      timestamp: new Date().toISOString(),
    })
    return { handled: false }
  }
}

// ── Sweeps ───────────────────────────────────────────────────────────────────

export interface StuckJobLike {
  processedOn?: number | null
  token?: string | null
  data: { engine_job_id?: string }
}

/** Pure stuck filter: active jobs older than the timeout. */
export function findStuckJobs<T extends StuckJobLike>(
  jobs: T[],
  nowMs: number,
  timeoutMs: number = STUCK_TIMEOUT_MS,
): T[] {
  return jobs.filter((job) => nowMs - (job.processedOn ?? nowMs) > timeoutMs)
}

/** Stuck-job recovery sweep: fail jobs older than STUCK_TIMEOUT_MS. */
export async function recoverStuckJobs(
  getActive: () => Promise<StuckJobLike[]>,
  fail: (job: StuckJobLike) => Promise<void>,
  nowMs: number = Date.now(),
): Promise<number> {
  try {
    const stuck = findStuckJobs(await getActive(), nowMs)
    for (const job of stuck) {
      logEvent('error', 'stuck_job', {
        engine_job_id: job.data.engine_job_id,
        age_minutes: Math.round((nowMs - (job.processedOn ?? nowMs)) / 60000),
      })
      await fail(job)
    }
    return stuck.length
  } catch (err) {
    logEvent('error', 'stuck_job_recovery_error', { error: String(err) })
    return 0
  }
}

/** Retention sweep (§30): prune analyses past RETENTION_DAYS. */
export async function pruneOldAnalyses(
  prune: () => Promise<number> = pruneRetention,
): Promise<number> {
  try {
    const pruned = await prune()
    if (pruned > 0) {
      logEvent('info', 'retention_pruned', { analyses: pruned })
    }
    return pruned
  } catch (err) {
    logEvent('error', 'retention_prune_error', { error: String(err) })
    return 0
  }
}

export interface SweepClocks {
  setIntervalFn?: typeof setInterval
  setTimeoutFn?: typeof setTimeout
  clearIntervalFn?: typeof clearInterval
}

/** Schedule both sweeps (plus their staggered initial runs). Returns a stopper. */
export function startSweeps(
  runStuckRecovery: () => void | Promise<void>,
  runRetentionPrune: () => void | Promise<void>,
  clocks: SweepClocks = {},
): { stop: () => void } {
  const setI = clocks.setIntervalFn ?? setInterval
  const setT = clocks.setTimeoutFn ?? setTimeout
  const clearI = clocks.clearIntervalFn ?? clearInterval

  const stuckRecoveryInterval = setI(() => {
    void runStuckRecovery()
  }, STUCK_SWEEP_INTERVAL_MS)
  stuckRecoveryInterval.unref()
  setT(() => {
    void runStuckRecovery()
  }, STUCK_SWEEP_INITIAL_DELAY_MS)

  const retentionInterval = setI(() => {
    void runRetentionPrune()
  }, RETENTION_SWEEP_INTERVAL_MS)
  retentionInterval.unref()
  setT(() => {
    void runRetentionPrune()
  }, RETENTION_SWEEP_INITIAL_DELAY_MS)

  return {
    stop: () => {
      clearI(stuckRecoveryInterval)
      clearI(retentionInterval)
    },
  }
}

// ── Shutdown ordering ────────────────────────────────────────────────────────

export interface Closable {
  close: () => Promise<unknown>
}

/**
 * Close stages strictly in order (workers → events → queues → connections),
 * continuing past per-stage errors so one stuck handle can't block the rest.
 */
export async function shutdownInOrder(stages: Closable[]): Promise<void> {
  for (const stage of stages) {
    try {
      await stage.close()
    } catch (err) {
      logEvent('error', 'shutdown_stage_error', {
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }
}

/** Wrap a boot routine so concurrent/repeat calls run it exactly once. */
export function createIdempotentBoot(start: () => Promise<void>): () => Promise<void> {
  let booted = false
  let pending: Promise<void> | null = null
  return () => {
    if (booted) return Promise.resolve()
    if (pending) return pending
    pending = start().then(
      () => {
        booted = true
        pending = null
      },
      (err) => {
        pending = null
        throw err
      },
    )
    return pending
  }
}
