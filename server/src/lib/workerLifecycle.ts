// ── Worker lifecycle ─────────────────────────────────────────────────────────
// Minimal lifecycle over caller-shaped job kinds: connections + queues live at
// module load (so enqueue works pre-boot), while workers, QueueEvents, sweeps,
// and signal handlers start only via ONE explicit bootWorkers() call from
// index.ts. queue.ts re-exports the caller-facing API so call sites need zero
// edits.
//
// Shutdown order follows BullMQ v5 practice: worker.close() is graceful (stops
// fetching, waits for active jobs), so on shutdown close WORKERS FIRST, then
// QueueEvents/queues/connections.
//
// The run*/handle*/find*/shutdownInOrder/createIdempotentBoot/startSweeps
// helpers below are dependency-injected (no Redis/BullMQ/Supabase) so tests
// can exercise them with in-memory fakes. The thin BullMQ closures in
// doBootReal delegate to them with the real adapters.

import { Queue, Worker, QueueEvents, UnrecoverableError } from 'bullmq'
import { randomUUID } from 'crypto'
import type { Redis } from 'ioredis'
import { markEngineJobFailed, getEngineJobStatus, analyzeVideo } from './engine'
import { saveJob, getJob } from './jobs'
import { shutdownHistoryStore } from './historyStore'
import { persistAnalysisStatus } from './analyses'
import { pruneRetention } from './analysisPolicy'
import { wrapEngineError, isQueueRetryable, isCoachAIError } from './errors'
import type { CoachAIError } from '../types'
import { DEFAULT_MODEL } from '../types'
import {
  initAiReportJob,
  updateAiReportJob,
  persistAiReportRecord,
  generateAiReport,
} from './aiReportData'

// ── Names + defaults (preserved from queue.ts) ───────────────────────────────

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

// ── Connection + queues (eager: enqueue must work before boot) ──────────────

// Derive Redis protocol URL from Upstash REST URL and token
// REST URL format: https://<endpoint>.upstash.io
// Redis protocol format: rediss://default:<token>@<endpoint>.upstash.io:6379
function getRedisConnection(): Redis | null {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!restUrl || !token) return null

  // Extract endpoint from REST URL
  const urlObj = new URL(restUrl)
  const host = urlObj.host // e.g., "neutral-urchin-104723.upstash.io"

  // Construct Redis protocol URL with TLS
  const redisUrl = `rediss://default:${token}@${host}:6379`

  // Connect to Redis at module load time
  try {
    const IORedis = require('ioredis') as typeof import('ioredis').default
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      tls: {},
      // Upstash recommended settings for serverless
      enableReadyCheck: false,
      lazyConnect: true,
      commandTimeout: 30000,
      connectTimeout: 30000,
      retryStrategy(times: number) {
        if (times > 10) return null
        return Math.min(times * 500, 5000)
      },
    })
    client.on('error', (err: Error) => {
      console.error(
        JSON.stringify({
          type: 'redis_error',
          source: 'queue',
          message: err.message,
        }),
      )
    })
    client.on('reconnecting', (delay: number) => {
      console.warn(
        JSON.stringify({
          type: 'redis_reconnecting',
          source: 'queue',
          delay_ms: delay,
        }),
      )
    })
    return client
  } catch {
    console.error(
      JSON.stringify({
        type: 'queue_unavailable',
        message: 'ioredis not available, queue disabled',
      }),
    )
    return null
  }
}

const connection = getRedisConnection()
const redisAvailable = !!connection

export const analysisQueue = redisAvailable
  ? new Queue(ANALYSIS_QUEUE_NAME, {
      connection: connection!,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS },
    })
  : null

export const aiReportQueue = redisAvailable
  ? new Queue(REPORT_QUEUE_NAME, {
      connection: connection!,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS },
    })
  : null

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

/** Shared enqueue path for analyze-video and me/analyze-video. */
export async function enqueueAnalysis(job: AnalysisPayload): Promise<void> {
  await saveJob({
    server_job_id: job.server_job_id,
    engine_job_id: job.engine_job_id,
    session_token: job.session_token,
    player_index: job.player_index,
    model: DEFAULT_MODEL,
    created_at: Date.now(),
    owner_ids: job.owner_ids ?? [],
  })

  if (!analysisQueue) {
    throw new Error('QUEUE_UNAVAILABLE')
  }
  await analysisQueue.add(job.server_job_id, job, {
    priority: job.priority ?? JOB_PRIORITY,
  })
}

/**
 * Create a queued report job record and enqueue the BullMQ job. Returns the
 * report_job_id, or null when the queue is not configured.
 */
export const enqueueAiReport = async (
  payload: Omit<AiReportPayload, 'report_job_id'>,
): Promise<string | null> => {
  if (!aiReportQueue) return null
  const reportJobId = randomUUID()
  await initAiReportJob({
    report_job_id: reportJobId,
    auth0_id: payload.auth0_id,
  })
  await aiReportQueue.add('ai-report', {
    ...payload,
    report_job_id: reportJobId,
  })
  return reportJobId
}

// ── Pure job-kind core (dependency-injected, no Redis/BullMQ/Supabase) ───────

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
  // Idempotency check: skip if job already processed (race with status poll)
  if (isTerminalJobState(await getState())) {
    return { ok: true, skipped: 'already_terminal' }
  }

  const { engine_job_id, session_token, player_index, video_key, angle } = data

  // Cross the same engine adapter as the routes — one client, one
  // timeout posture, one error shape.
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

  // Persist completed status immediately so history is accurate even if
  // the client never polls again (browser closed, network drop, etc.)
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
    // Non-fatal — client polling will catch up; log and continue
    console.error(
      JSON.stringify({
        type: 'worker_completion_persist_error',
        engine_job_id,
        error: persistErr instanceof Error ? persistErr.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    )
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
  // Idempotency check: skip if already terminal (race with status poll)
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
    await deps.updateAiReportJob(report_job_id, {
      status: 'running',
      progress: 10,
    })
    const { report, raw } = await deps.generateAiReport(
      {
        report_context,
        report_type,
        sport,
        student_name,
      },
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

    // Mark failed if: retries exhausted OR unrecoverable error
    if (!mark) return { handled: false }

    // Extract error code from UnrecoverableError message if present
    let errorCode = 'ANALYSIS_FAILED'
    let retryable = true
    if (unrecoverable && event.failedReason) {
      const code = extractUnrecoverableCode(event.failedReason)
      if (code) {
        errorCode = code
        retryable = false
      }
    }

    await deps.markEngineJobFailed(
      bullJob.data.engine_job_id,
      unrecoverable && event.failedReason
        ? event.failedReason
        : 'Analysis failed after retries. Please try again.',
      errorCode,
      retryable,
      bullJob.data.server_job_id,
    )

    // Persist failed status to history so it appears even if client stops polling
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
          error:
            unrecoverable && event.failedReason
              ? event.failedReason
              : 'Analysis failed after retries. Please try again.',
          error_code: errorCode,
          retryable,
        },
      })
    } catch (persistErr) {
      console.error(
        JSON.stringify({
          type: 'failed_persist_history_error',
          engine_job_id: bullJob.data.engine_job_id,
          error: persistErr instanceof Error ? persistErr.message : 'unknown',
          timestamp: new Date().toISOString(),
        }),
      )
    }

    console.error(
      JSON.stringify({
        type: unrecoverable ? 'job_unrecoverable' : 'job_exhausted',
        engine_job_id: bullJob.data.engine_job_id,
        attempts: bullJob.attemptsMade,
        error_code: errorCode,
      }),
    )
    return { handled: true, errorCode, retryable }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'failed_event_handler_error',
        jobId: event.jobId,
        error: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    )
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
    console.error(
      JSON.stringify({
        type: 'ai_report_failed_event_error',
        jobId: event.jobId,
        error: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    )
    return { handled: false }
  }
}

// ── Sweeps as adapters ───────────────────────────────────────────────────────

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
      console.error(
        JSON.stringify({
          type: 'stuck_job',
          engine_job_id: job.data.engine_job_id,
          age_minutes: Math.round((nowMs - (job.processedOn ?? nowMs)) / 60000),
        }),
      )
      await fail(job)
    }
    return stuck.length
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'stuck_job_recovery_error',
        error: String(err),
      }),
    )
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
      console.log(JSON.stringify({ type: 'retention_pruned', analyses: pruned }))
    }
    return pruned
  } catch (err) {
    console.error(JSON.stringify({ type: 'retention_prune_error', error: String(err) }))
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
      console.error(
        JSON.stringify({
          type: 'shutdown_stage_error',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
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

// ── Real boot / shutdown ─────────────────────────────────────────────────────

let analysisWorker: Worker<AnalysisPayload> | null = null
let reportWorker: Worker<AiReportPayload> | null = null
let analysisEvents: QueueEvents | null = null
let reportEvents: QueueEvents | null = null
let sweeps: { stop: () => void } | null = null
let signalsRegistered = false
let shuttingDown = false

function attachAnalysisWorkerHandlers(worker: Worker<AnalysisPayload>): void {
  worker.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'worker_error',
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })
}

function attachReportWorkerHandlers(worker: Worker<AiReportPayload>): void {
  worker.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'ai_report_worker_error',
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })
}

async function doBootReal(): Promise<void> {
  if (!redisAvailable || !analysisQueue || !aiReportQueue || !connection) {
    console.error(
      JSON.stringify({
        type: 'queue_unavailable',
        message: 'workers not started, queue disabled',
      }),
    )
    return
  }

  // The worker calls the engine synchronously.
  // BullMQ manages concurrency — engine processes one job at a time.
  analysisWorker = new Worker<AnalysisPayload>(
    ANALYSIS_QUEUE_NAME,
    async (job) =>
      runAnalysisProcessor(job.data, () => job.getState(), {
        analyzeVideo,
        getEngineJobStatus,
        getJob,
        persistAnalysisStatus,
      }),
    {
      connection: connection!,
      // Single concurrency for 512MB RAM free tier (configurable via WORKER_CONCURRENCY)
      concurrency: getAnalysisWorkerConcurrency(),
    },
  )
  attachAnalysisWorkerHandlers(analysisWorker)
  analysisWorker.on('stalled', (jobId) => {
    console.warn(
      JSON.stringify({
        type: 'worker_stalled',
        jobId,
        timestamp: new Date().toISOString(),
      }),
    )
  })

  reportWorker = new Worker<AiReportPayload>(
    REPORT_QUEUE_NAME,
    async (job) =>
      runAiReportProcessor(job.data, () => job.getState(), {
        updateAiReportJob,
        generateAiReport,
        persistAiReportRecord,
      }),
    {
      connection: connection!,
      // Reports are LLM-bound, not video-bound; stay serialized like analysis.
      concurrency: getReportWorkerConcurrency(),
    },
  )
  attachReportWorkerHandlers(reportWorker)

  // Handle jobs exhausting all retries (terminal-failure persistence).
  analysisEvents = new QueueEvents(ANALYSIS_QUEUE_NAME, {
    connection: connection!,
  })
  analysisEvents.on('failed', async ({ jobId, failedReason }) => {
    await handleAnalysisFailure({ jobId, failedReason }, (id) => analysisQueue!.getJob(id), {
      markEngineJobFailed,
      getJob,
      persistAnalysisStatus,
    })
  })
  analysisEvents.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'queue_events_error',
        queue: ANALYSIS_QUEUE_NAME,
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })

  // Handle report jobs exhausting all retries — mark the Redis record failed.
  reportEvents = new QueueEvents(REPORT_QUEUE_NAME, {
    connection: connection!,
  })
  reportEvents.on('failed', async ({ jobId, failedReason }) => {
    await handleReportFailure({ jobId, failedReason }, (id) => aiReportQueue!.getJob(id), {
      updateAiReportJob,
    })
  })
  reportEvents.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'queue_events_error',
        queue: REPORT_QUEUE_NAME,
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })

  // Queue-level error handlers
  analysisQueue.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'queue_error',
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })
  aiReportQueue.on('error', (err) => {
    console.error(
      JSON.stringify({
        type: 'ai_report_queue_error',
        message: err.message,
        timestamp: new Date().toISOString(),
      }),
    )
  })

  // Stuck-job recovery + retention pruning as sweep adapters.
  sweeps = startSweeps(
    () => {
      void recoverStuckJobs(
        () => analysisQueue!.getActive(),
        (job) =>
          (job as unknown as JobLike).moveToFailed(
            new UnrecoverableError('Job exceeded 13 minute timeout'),
            job.token ?? '0',
            true,
          ),
      )
    },
    () => {
      void pruneOldAnalyses()
    },
  )

  registerSignalHandlers()
}

interface JobLike {
  moveToFailed: (err: Error, token: string, ignoreLock: boolean) => Promise<void>
}

function registerSignalHandlers(): void {
  if (signalsRegistered) return
  signalsRegistered = true
  process.on('SIGTERM', () => {
    void shutdownWorkers('SIGTERM')
  })
  process.on('SIGINT', () => {
    void shutdownWorkers('SIGINT')
  })
}

export const bootWorkers = createIdempotentBoot(async () => {
  try {
    await doBootReal()
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'worker_boot_error',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
})

export async function shutdownWorkers(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(
    JSON.stringify({
      type: 'shutdown_start',
      signal,
      timestamp: new Date().toISOString(),
    }),
  )

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ type: 'shutdown_timeout', signal }))
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  try {
    sweeps?.stop()
    // BullMQ v5: worker.close() is graceful (stops fetching, waits for active
    // jobs) — close WORKERS FIRST, then QueueEvents, queues, and connections.
    const stages: Closable[] = []
    if (analysisWorker) {
      const w = analysisWorker
      stages.push({ close: () => w.close() })
    }
    if (reportWorker) {
      const w = reportWorker
      stages.push({ close: () => w.close() })
    }
    if (analysisEvents) {
      const e = analysisEvents
      stages.push({ close: () => e.close() })
    }
    if (reportEvents) {
      const e = reportEvents
      stages.push({ close: () => e.close() })
    }
    if (analysisQueue) {
      const q = analysisQueue
      stages.push({ close: () => q.close() })
    }
    if (aiReportQueue) {
      const q = aiReportQueue
      stages.push({ close: () => q.close() })
    }
    if (connection) {
      const c = connection
      stages.push({
        close: () => c.quit().then(() => undefined),
      })
    }
    await shutdownInOrder(stages)
    await shutdownHistoryStore()
    console.log(
      JSON.stringify({
        type: 'shutdown_complete',
        signal,
        timestamp: new Date().toISOString(),
      }),
    )
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'shutdown_error',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
  process.exit(0)
}

export async function getAnalysisQueueStats(): Promise<{ waiting: number; failed: number }> {
  if (!analysisQueue) return { waiting: 0, failed: 0 }
  const [waiting, failed] = await Promise.all([
    analysisQueue.getWaitingCount(),
    analysisQueue.getFailedCount(),
  ])
  return { waiting, failed }
}

export { analysisWorker as worker, reportWorker as aiReportWorker }
