import { Queue, Worker, QueueEvents, UnrecoverableError } from 'bullmq'
import { randomUUID } from 'crypto'
import type { Redis } from 'ioredis'
import { markEngineJobFailed, getEngineJobStatus } from './engine'
import { saveJob, getJob } from './jobs'
import {
  shutdownHistoryStore,
} from './historyStore'
import {
  persistAnalysisStatus,
  pruneRetention,
} from './analyses'
import { wrapEngineError, isQueueRetryable, isCoachAIError } from './errors'
import { analyzeVideo } from './engine'
import { DEFAULT_MODEL } from '../types'
import {
  initAiReportJob,
  updateAiReportJob,
  persistAiReportRecord,
  generateAiReport,
} from './aiReportData'

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

// Job priority (BullMQ: higher number = higher priority)
export const JOB_PRIORITY = 0

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

// The worker calls the engine synchronously.
// BullMQ manages concurrency — engine processes one job at a time.
const worker = redisAvailable
  ? new Worker<AnalysisPayload>(
      'coachai-analysis',
      async (job) => {
        const { engine_job_id, session_token, player_index, video_key, angle } = job.data

        // Idempotency check: skip if job already processed (race with status poll)
        const existingJob = await job.getState()
        if (existingJob === 'completed' || existingJob === 'failed') {
          return { ok: true, skipped: 'already_terminal' }
        }

        // Cross the same engine adapter as the routes — one client, one
        // timeout posture, one error shape.
        try {
          await analyzeVideo(
            { engine_job_id, session_token, player_index, video_key, angle },
            job.data.server_job_id,
          )
        } catch (error) {
          const engineError = isCoachAIError(error)
            ? error
            : wrapEngineError({
                message: error instanceof Error ? error.message : 'Unknown engine error.',
              })

          // The engine owns retryability. Non-retryable errors will never
          // succeed on retry, so throw UnrecoverableError to stop BullMQ
          // (attempts: 3) from retrying a doomed job.
          if (!isQueueRetryable(engineError)) {
            throw new UnrecoverableError(`${engineError.code}: ${engineError.message}`)
          }

          throw engineError
        }

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

        return { ok: true }
      },
      {
        connection: connection!,
        // Single concurrency for 512MB RAM free tier (configurable via WORKER_CONCURRENCY)
        concurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
      },
    )
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

// Handle job exhausting all retries
let queueEvents: QueueEvents | null = null
if (redisAvailable && analysisQueue) {
  queueEvents = new QueueEvents('coachai-analysis', {
    connection: connection!,
  })

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const bullJob = await analysisQueue!.getJob(jobId)
      if (!bullJob?.data?.engine_job_id) return

      const isUnrecoverable = failedReason?.includes('UnrecoverableError')
      const retriesExhausted = (bullJob.attemptsMade ?? 0) >= (bullJob.opts?.attempts ?? 3)

      // Mark failed if: retries exhausted OR unrecoverable error
      if (retriesExhausted || isUnrecoverable) {
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
            status: {
              stage: -1,
              stage_name: 'Failed',
              progress: 0,
              complete: true,
              video_ready: false,
              summary: null,
              error: isUnrecoverable
                ? failedReason
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

  const stuckRecoveryInterval = setInterval(recoverStuckJobs, 10 * 60 * 1000)
  stuckRecoveryInterval.unref()
  setTimeout(recoverStuckJobs, 30_000)

  // Retention pruning (§30) — daily sweep of analyses past RETENTION_DAYS.
  async function pruneOldAnalyses(): Promise<void> {
    try {
      const pruned = await pruneRetention()
      if (pruned > 0) {
        console.log(JSON.stringify({ type: 'retention_pruned', analyses: pruned }))
      }
    } catch (err) {
      console.error(JSON.stringify({ type: 'retention_prune_error', error: String(err) }))
    }
  }

  const retentionInterval = setInterval(pruneOldAnalyses, 24 * 60 * 60 * 1000)
  retentionInterval.unref()
  setTimeout(pruneOldAnalyses, 60_000)
}

// ── AI Report Queue ─────────────────────────────────────────────────────────
// One-click AI reports: the route enqueues a job that calls engine /report
// synchronously, persists the report row, and marks the Redis job record done
// so the polling route can return the report.

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

export const aiReportQueue = redisAvailable
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

const aiReportWorker = redisAvailable
  ? new Worker<AiReportPayload>(
      'coachai-report',
      async (job) => {
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

        // Idempotency check: skip if already terminal (race with status poll)
        const existingJob = await job.getState()
        if (existingJob === 'completed' || existingJob === 'failed') {
          return { ok: true, skipped: 'already_terminal' }
        }

        try {
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
          return { ok: true }
        } catch (error) {
          const engineError = isCoachAIError(error)
            ? error
            : wrapEngineError({
                message: error instanceof Error ? error.message : 'Unknown AI report error.',
              })

          if (!isQueueRetryable(engineError)) {
            await updateAiReportJob(report_job_id, {
              status: 'failed',
              error: `${engineError.code}: ${engineError.message}`,
            })
            throw new UnrecoverableError(`${engineError.code}: ${engineError.message}`)
          }

          await updateAiReportJob(report_job_id, {
            status: 'failed',
            error: `${engineError.code}: ${engineError.message}`,
          })
          throw engineError
        }
      },
      {
        connection: connection!,
        // Reports are LLM-bound, not video-bound; stay serialized like analysis.
        concurrency: Number(process.env.REPORT_WORKER_CONCURRENCY) || 1,
      },
    )
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

// Handle report jobs exhausting all retries — mark the Redis record failed.
let reportQueueEvents: QueueEvents | null = null
if (redisAvailable && aiReportQueue) {
  reportQueueEvents = new QueueEvents('coachai-report', {
    connection: connection!,
  })

  reportQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const bullJob = await aiReportQueue!.getJob(jobId)
      const reportJobId = bullJob?.data?.report_job_id
      if (!reportJobId) return

      const retriesExhausted = (bullJob.attemptsMade ?? 0) >= (bullJob.opts?.attempts ?? 3)
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

// ── Graceful Shutdown ──────────────────────────────────────────────────────
// Per BullMQ docs: must close both worker AND queue (each creates own Redis connection)
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
    if (queueEvents) await queueEvents.close()
    if (reportQueueEvents) await reportQueueEvents.close()
    if (worker) await worker.close()
    if (aiReportWorker) await aiReportWorker.close()
    if (analysisQueue) await analysisQueue.close()
    if (aiReportQueue) await aiReportQueue.close()
    if (connection) await connection.quit()
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

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

export { worker, aiReportWorker }
