// ── BullMQ orchestration (lazily started) ───────────────────────────────────
// Importing this module is side-effect-free: no Redis connection, no queues,
// no workers, no intervals, no signal handlers. Production builds everything
// exactly once via startQueueInfrastructure() — called first thing in
// src/index.ts — and tears it down via stopQueueInfrastructure() from the
// graceful-shutdown path. Exported instances are live bindings: importers
// (routes/health, lib/notifications) observe them after start.

import { Queue, Worker, QueueEvents, UnrecoverableError } from 'bullmq'
import type { Job } from 'bullmq'
import { randomUUID } from 'crypto'
import type { Redis } from 'ioredis'
import { markEngineJobFailed, getEngineJobStatus } from './engine'
import { saveJob, getJob } from './jobs'
import { shutdownHistoryStore } from './historyStore'
import { persistAnalysisStatus } from './analyses'
import { wrapEngineError, isQueueRetryable, isCoachAIError, type CoachAIError } from './errors'
import { analyzeVideo } from './engine'
import { getRedisConnectionUrl, isLocalRedis } from './redis'
import { startRetentionSweep, stopRetentionSweep } from './retention'
import { DEFAULT_MODEL } from '../types'
import {
  initAiReportJob,
  updateAiReportJob,
  persistAiReportRecord,
  generateAiReport,
} from './aiReportData'

// ── Job payloads ────────────────────────────────────────────────────────────

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

// ── BullMQ Redis client ─────────────────────────────────────────────────────
// The URL comes from the single derivation exported by lib/redis.ts
// (localhost → plain redis://, Upstash → TLS scheme + embedded token). Client
// OPTIONS remain this module's own: 30s timeouts, lazyConnect, capped
// retry — one derivation, two legitimate option postures.
function createQueueRedisClient(): Redis | null {
  const redisUrl = getRedisConnectionUrl()
  if (!redisUrl) return null

  try {
    const IORedis = require('ioredis') as typeof import('ioredis').default
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      // Localhost is plain TCP; Upstash needs TLS (see lib/redis.ts).
      ...(isLocalRedis() ? {} : { tls: {} }),
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

// ── Failure policy (single definition) ──────────────────────────────────────
// The retry-policy verdict for a failed job. This module owns retry policy,
// so this is the ONE definition: the analysis failed-handler, the report
// failed-handler, lib/notifications.ts, and tests all derive their verdicts
// from it instead of re-implementing the comparison.

export type FailureVerdict = {
  /** The job failed with a BullMQ UnrecoverableError (no retry will run). */
  isUnrecoverable: boolean
  /** Every allowed attempt has been consumed. */
  retriesExhausted: boolean
  /** Final iff retries are exhausted OR the error is unrecoverable. */
  isFinalFailure: boolean
}

export function classifyFailure(
  failedReason: string | undefined,
  attemptsMade: number | undefined,
  maxAttempts: number | undefined,
): FailureVerdict {
  const isUnrecoverable = failedReason?.includes('UnrecoverableError') ?? false
  const retriesExhausted = (attemptsMade ?? 0) >= (maxAttempts ?? 3)
  return {
    isUnrecoverable,
    retriesExhausted,
    isFinalFailure: retriesExhausted || isUnrecoverable,
  }
}

// ── Shared worker template ──────────────────────────────────────────────────
// Both the analysis worker and the AI-report worker follow the same
// skeleton: skip already-terminal jobs, classify thrown errors through the
// engine's retryability contract, translate non-retryable errors into
// BullMQ's UnrecoverableError, and let each queue persist its own
// failure side effects via hooks.

type WorkerTemplateOptions<D> = {
  /** Fallback message when the thrown value is not a CoachAIError. */
  unknownErrorMessage: string
  /** The fallible step — its errors are classified for retry below. */
  step: (job: Job<D>) => Promise<void>
  /** Runs after `step` succeeds, outside error classification. */
  afterSuccess?: (job: Job<D>) => Promise<void>
  /** Runs with the classified error before it is rethrown — the failure
   *  side effect differs per queue (engine marking vs Redis record), so it
   *  stays a hook rather than template policy. */
  onClassifiedError?: (job: Job<D>, engineError: CoachAIError) => Promise<void>
}

function createWorkerProcessor<D>(
  options: WorkerTemplateOptions<D>,
): (job: Job<D>) => Promise<{ ok: true; skipped?: 'already_terminal' }> {
  return async (job) => {
    // Idempotency check: skip if the job is already terminal (race with the
    // status poll)
    const state = await job.getState()
    if (state === 'completed' || state === 'failed') {
      return { ok: true, skipped: 'already_terminal' }
    }

    try {
      await options.step(job)
    } catch (error) {
      const engineError = isCoachAIError(error)
        ? error
        : wrapEngineError({
            message: error instanceof Error ? error.message : options.unknownErrorMessage,
          })

      if (options.onClassifiedError) {
        await options.onClassifiedError(job, engineError)
      }

      // The engine owns retryability. Non-retryable errors will never
      // succeed on retry, so throw UnrecoverableError to stop BullMQ
      // (attempts: 3) from retrying a doomed job.
      if (!isQueueRetryable(engineError)) {
        throw new UnrecoverableError(`${engineError.code}: ${engineError.message}`)
      }

      throw engineError
    }

    if (options.afterSuccess) {
      await options.afterSuccess(job)
    }
    return { ok: true }
  }
}

// ── Synthetic status payloads ───────────────────────────────────────────────
/**
 * The shared synthetic "Failed" status persisted for terminal failures: the
 * analysis queue's exhausted/unrecoverable path and the job-status route's
 * expired-job path write this identical skeleton and differ only in the
 * error/error_code/retryable overrides. Key order is part of the persisted
 * `status_json` shape — keep it stable. (The completion and engine-poll
 * payloads use different defaults — stage 6/-1, retryable false/true, … —
 * and are deliberately NOT funneled through here.)
 */
export const buildFailedAnalysisStatus = (overrides: {
  error: string
  error_code: string
  retryable: boolean
}) => ({
  stage: -1,
  stage_name: 'Failed',
  progress: 0,
  complete: true,
  video_ready: false,
  summary: null,
  ...overrides,
})

// ── Infrastructure state (lazily built) ─────────────────────────────────────
let connection: Redis | null = null
export let analysisQueue: Queue | null = null
export let aiReportQueue: Queue | null = null
export let worker: Worker<AnalysisPayload> | null = null
export let aiReportWorker: Worker<AiReportPayload> | null = null
export let queueEvents: QueueEvents | null = null
let reportQueueEvents: QueueEvents | null = null
let stuckRecoveryInterval: ReturnType<typeof setInterval> | null = null
let stuckRecoveryTimeout: ReturnType<typeof setTimeout> | null = null
let started = false

type ReadyCallback = () => void
const readyCallbacks: ReadyCallback[] = []

/**
 * Subscribe to infrastructure startup. The callback runs once the shared
 * handles exist — immediately if startQueueInfrastructure() has already run —
 * so subscribers (lib/notifications) attach their QueueEvents listeners
 * exactly once per built instance, whether they load before or after start.
 */
export function onQueueInfrastructureReady(callback: ReadyCallback): void {
  if (started) {
    callback()
    return
  }
  readyCallbacks.push(callback)
}

// ── Enqueue API ─────────────────────────────────────────────────────────────

// Job priority (BullMQ: higher number = higher priority)
export const JOB_PRIORITY = 0

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

// ── Worker processors (shared template) ─────────────────────────────────────

const analysisProcessor = createWorkerProcessor<AnalysisPayload>({
  unknownErrorMessage: 'Unknown engine error.',
  step: async (job) => {
    const { engine_job_id, session_token, player_index, video_key, angle } = job.data
    // Cross the same engine adapter as the routes — one client, one
    // timeout posture, one error shape.
    await analyzeVideo(
      { engine_job_id, session_token, player_index, video_key, angle },
      job.data.server_job_id,
    )
  },
  afterSuccess: async (job) => {
    const { engine_job_id } = job.data
    // Persist completed status immediately so history is accurate even if
    // the client never polls again (browser closed, network drop, etc.)
    try {
      const statusResult = await getEngineJobStatus(engine_job_id, job.data.server_job_id)
      if (statusResult.status === 'found') {
        const engineStatus = statusResult.data
        const serverJob = await getJob(job.data.server_job_id)
        await persistAnalysisStatus({
          serverJobId: job.data.server_job_id,
          engineJobId: engine_job_id,
          sessionToken: job.data.session_token,
          playerIndex: job.data.player_index,
          model: serverJob?.model ?? DEFAULT_MODEL,
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
  },
})

const reportProcessor = createWorkerProcessor<AiReportPayload>({
  unknownErrorMessage: 'Unknown AI report error.',
  step: async (job) => {
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
    } = job.data

    await updateAiReportJob(report_job_id, {
      status: 'running',
      progress: 10,
    })
    const { report, raw } = await generateAiReport(
      {
        report_context,
        report_type,
        sport,
        student_name,
      },
      report_job_id,
    )
    const persisted = await persistAiReportRecord({
      auth0_id,
      report_type: report_type as Parameters<typeof persistAiReportRecord>[0]['report_type'],
      title: title ?? 'AI Report',
      period_start: period_start ?? null,
      period_end: period_end ?? null,
      student_id: student_id ?? null,
      report,
      raw,
    })
    await updateAiReportJob(report_job_id, {
      status: 'done',
      progress: 100,
      report_id: persisted.id,
    })
  },
  onClassifiedError: async (job, engineError) => {
    await updateAiReportJob(job.data.report_job_id, {
      status: 'failed',
      error: `${engineError.code}: ${engineError.message}`,
    })
  },
})

// ── Stuck job recovery ──────────────────────────────────────────────────────

// Stuck job recovery — runs every 10 minutes
async function recoverStuckJobs(): Promise<void> {
  try {
    const active = await analysisQueue!.getActive()
    const STUCK_MS = 13 * 60 * 1000 // 13 minutes (1 min buffer over worker 12 min timeout)

    for (const job of active) {
      const age = Date.now() - (job.processedOn ?? Date.now())
      if (age > STUCK_MS) {
        console.error(
          JSON.stringify({
            type: 'stuck_job',
            engine_job_id: job.data.engine_job_id,
            age_minutes: Math.round(age / 60000),
          }),
        )
        await job.moveToFailed(
          new UnrecoverableError('Job exceeded 13 minute timeout'),
          job.token ?? '0',
          true,
        )
      }
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'stuck_job_recovery_error',
        error: String(err),
      }),
    )
  }
}

// ── Infrastructure construction ─────────────────────────────────────────────

function startAnalysisInfrastructure(): void {
  const redisAvailable = !!connection

  analysisQueue = redisAvailable
    ? new Queue('coachai-analysis', {
        connection: connection!,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      })
    : null

  // The worker calls the engine synchronously.
  // BullMQ manages concurrency — engine processes one job at a time.
  worker = redisAvailable
    ? new Worker<AnalysisPayload>('coachai-analysis', analysisProcessor, {
        connection: connection!,
        // Single concurrency for 512MB RAM free tier (configurable via WORKER_CONCURRENCY)
        concurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
      })
    : null

  // Worker health event handlers
  if (worker) {
    worker.on('error', (err) => {
      console.error(
        JSON.stringify({
          type: 'worker_error',
          message: err.message,
          timestamp: new Date().toISOString(),
        }),
      )
    })
    worker.on('stalled', (jobId) => {
      console.warn(
        JSON.stringify({
          type: 'worker_stalled',
          jobId,
          timestamp: new Date().toISOString(),
        }),
      )
    })
  }

  if (redisAvailable && analysisQueue) {
    queueEvents = new QueueEvents('coachai-analysis', {
      connection: connection!,
    })

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      try {
        const bullJob = await analysisQueue!.getJob(jobId)
        if (!bullJob?.data?.engine_job_id) return

        const { isUnrecoverable, isFinalFailure } = classifyFailure(
          failedReason,
          bullJob.attemptsMade,
          bullJob.opts?.attempts,
        )

        // Mark failed if: retries exhausted OR unrecoverable error
        if (isFinalFailure) {
          // Extract error code from UnrecoverableError message if present
          let errorCode = 'ANALYSIS_FAILED'
          let retryable = true
          if (isUnrecoverable && failedReason) {
            const match = failedReason.match(/^(\w+):/)
            if (match) {
              errorCode = match[1]
              retryable = false
            }
          }

          await markEngineJobFailed(
            bullJob.data.engine_job_id,
            isUnrecoverable ? failedReason : 'Analysis failed after retries. Please try again.',
            errorCode,
            retryable,
            bullJob.data.server_job_id,
          )

          // Persist failed status to history so it appears even if client stops polling
          try {
            const serverJob = await getJob(bullJob.data.server_job_id)
            await persistAnalysisStatus({
              serverJobId: bullJob.data.server_job_id,
              engineJobId: bullJob.data.engine_job_id,
              sessionToken: bullJob.data.session_token,
              playerIndex: bullJob.data.player_index,
              model: serverJob?.model ?? DEFAULT_MODEL,
              status: buildFailedAnalysisStatus({
                error: isUnrecoverable
                  ? failedReason
                  : 'Analysis failed after retries. Please try again.',
                error_code: errorCode,
                retryable,
              }),
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
              type: isUnrecoverable ? 'job_unrecoverable' : 'job_exhausted',
              engine_job_id: bullJob.data.engine_job_id,
              attempts: bullJob.attemptsMade,
              error_code: errorCode,
            }),
          )
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            type: 'failed_event_handler_error',
            jobId,
            error: err instanceof Error ? err.message : 'unknown',
            timestamp: new Date().toISOString(),
          }),
        )
      }
    })

    // Queue-level error handler
    analysisQueue.on('error', (err) => {
      console.error(
        JSON.stringify({
          type: 'queue_error',
          message: err.message,
          timestamp: new Date().toISOString(),
        }),
      )
    })

    // Stuck job recovery — every 10 minutes, first run 30s after start.
    const stuckRecovery = setInterval(recoverStuckJobs, 10 * 60 * 1000)
    stuckRecovery.unref()
    stuckRecoveryInterval = stuckRecovery
    stuckRecoveryTimeout = setTimeout(recoverStuckJobs, 30_000)

    // Retention pruning (§30) — scheduling lives in lib/retention.ts
    // (governance domain, not the analysis queue's), started here under the
    // same Redis-availability gate, same daily cadence, same 60s first run.
    startRetentionSweep()
  }
}

function startReportInfrastructure(): void {
  const redisAvailable = !!connection

  aiReportQueue = redisAvailable
    ? new Queue('coachai-report', {
        connection: connection!,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      })
    : null

  aiReportWorker = redisAvailable
    ? new Worker<AiReportPayload>('coachai-report', reportProcessor, {
        connection: connection!,
        // Reports are LLM-bound, not video-bound; stay serialized like analysis.
        concurrency: Number(process.env.REPORT_WORKER_CONCURRENCY) || 1,
      })
    : null

  if (aiReportWorker) {
    aiReportWorker.on('error', (err) => {
      console.error(
        JSON.stringify({
          type: 'ai_report_worker_error',
          message: err.message,
          timestamp: new Date().toISOString(),
        }),
      )
    })
  }

  if (redisAvailable && aiReportQueue) {
    reportQueueEvents = new QueueEvents('coachai-report', {
      connection: connection!,
    })

    // Handle report jobs exhausting all retries — mark the Redis record failed.
    reportQueueEvents.on('failed', async ({ jobId, failedReason }) => {
      try {
        const bullJob = await aiReportQueue!.getJob(jobId)
        const reportJobId = bullJob?.data?.report_job_id
        if (!reportJobId) return

        const { retriesExhausted } = classifyFailure(
          failedReason,
          bullJob.attemptsMade,
          bullJob.opts?.attempts,
        )
        if (retriesExhausted) {
          await updateAiReportJob(reportJobId, {
            status: 'failed',
            error: failedReason ?? 'AI report failed after retries.',
          })
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            type: 'ai_report_failed_event_error',
            jobId,
            error: err instanceof Error ? err.message : 'unknown',
            timestamp: new Date().toISOString(),
          }),
        )
      }
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
  }
}

/**
 * Build the queues, workers, QueueEvents, intervals, and signal handlers —
 * exactly once per start. Called first thing from src/index.ts; never as an
 * import side effect. No-op when Redis is not configured (every handle stays
 * null, the same "queue disabled" posture the module had before, minus the
 * connections).
 */
export function startQueueInfrastructure(): void {
  if (started) return
  started = true

  connection = createQueueRedisClient()

  startAnalysisInfrastructure()
  startReportInfrastructure()

  // Graceful shutdown — registered with the infrastructure, not at import.
  process.on('SIGTERM', onSigterm)
  process.on('SIGINT', onSigint)

  // One-shot fan-out to subscribers that must attach to the shared handles
  // (lib/notifications binds its QueueEvents listeners here — exactly once
  // per built instance).
  for (const callback of readyCallbacks.splice(0, readyCallbacks.length)) {
    callback()
  }
}

/**
 * Close every handle startQueueInfrastructure built: intervals, QueueEvents,
 * workers, queues, the Redis connection, then the history store — the exact
 * order the graceful shutdown has always used. Safe to call when nothing is
 * built (all steps no-op on null).
 */
export async function stopQueueInfrastructure(): Promise<void> {
  // Stop timers first so no recovery/retention sweep runs mid-close.
  stopRetentionSweep()
  if (stuckRecoveryInterval) {
    clearInterval(stuckRecoveryInterval)
    stuckRecoveryInterval = null
  }
  if (stuckRecoveryTimeout) {
    clearTimeout(stuckRecoveryTimeout)
    stuckRecoveryTimeout = null
  }
  process.off('SIGTERM', onSigterm)
  process.off('SIGINT', onSigint)

  // Per BullMQ docs: must close both worker AND queue (each creates own Redis connection)
  if (queueEvents) await queueEvents.close()
  if (reportQueueEvents) await reportQueueEvents.close()
  if (worker) await worker.close()
  if (aiReportWorker) await aiReportWorker.close()
  if (analysisQueue) await analysisQueue.close()
  if (aiReportQueue) await aiReportQueue.close()
  if (connection) await connection.quit()

  queueEvents = null
  reportQueueEvents = null
  worker = null
  aiReportWorker = null
  analysisQueue = null
  aiReportQueue = null
  connection = null
  started = false

  await shutdownHistoryStore()
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000
let shuttingDown = false

const gracefulShutdown = async (signal: string) => {
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
    await stopQueueInfrastructure()
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

const onSigterm = () => gracefulShutdown('SIGTERM')
const onSigint = () => gracefulShutdown('SIGINT')
