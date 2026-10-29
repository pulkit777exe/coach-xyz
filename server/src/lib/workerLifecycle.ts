// ── Worker lifecycle ─────────────────────────────────────────────────────────
// Connections and queues exist at module load (so enqueue works before boot);
// workers, QueueEvents, sweeps, and signal handlers start only via ONE explicit
// bootWorkers() call from index.ts.
//
// Shutdown order follows BullMQ v5 practice: worker.close() is graceful (stops
// fetching, waits for active jobs), so close WORKERS FIRST, then
// QueueEvents/queues/connections.
//
// The job adapters themselves (retry mapping, processors, sweeps, shutdown
// helpers) are dependency-injected and live in ./workerJobs so tests can run
// them without Redis/BullMQ/Supabase. They are re-exported here to keep the
// single import surface used by routes and tests.
import { Queue, QueueEvents, UnrecoverableError, Worker } from 'bullmq'
import { randomUUID } from 'crypto'
import type { Redis } from 'ioredis'

import { DEFAULT_MODEL } from '../types'
import {
  generateAiReport,
  initAiReportJob,
  persistAiReportRecord,
  updateAiReportJob,
} from './aiReportData'
import { persistAnalysisStatus } from './analyses'
import { analyzeVideo, getEngineJobStatus, markEngineJobFailed } from './engine'
import { shutdownHistoryStore } from './historyStore'
import { getJob, saveJob } from './jobs'
import { logEvent } from './log'
import { buildQueueConnection } from './queueConnection'
import {
  ANALYSIS_QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
  JOB_PRIORITY,
  REPORT_QUEUE_NAME,
  SHUTDOWN_TIMEOUT_MS,
  createIdempotentBoot,
  handleAnalysisFailure,
  handleReportFailure,
  pruneOldAnalyses,
  recoverStuckJobs,
  runAiReportProcessor,
  runAnalysisProcessor,
  shutdownInOrder,
  startSweeps,
} from './workerJobs'
import type { AiReportPayload, AnalysisPayload, Closable } from './workerJobs'

export * from './workerJobs'

// ── Connection + queues (eager: enqueue must work before boot) ──────────────

function getRedisConnection(): Redis | null {
  try {
    return buildQueueConnection('queue')
  } catch {
    logEvent('error', 'queue_unavailable', {
      message: 'ioredis not available, queue disabled',
    })
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

// ── Enqueue paths ────────────────────────────────────────────────────────────

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
  await initAiReportJob({ report_job_id: reportJobId, auth0_id: payload.auth0_id })
  await aiReportQueue.add('ai-report', { ...payload, report_job_id: reportJobId })
  return reportJobId
}

// ── Real boot / shutdown ─────────────────────────────────────────────────────

let analysisWorker: Worker<AnalysisPayload> | null = null
let reportWorker: Worker<AiReportPayload> | null = null
let analysisEvents: QueueEvents | null = null
let reportEvents: QueueEvents | null = null
let sweeps: { stop: () => void } | null = null
let signalsRegistered = false
let shuttingDown = false

function attachWorkerErrorHandler(worker: Worker, type: string): void {
  worker.on('error', (err) => {
    logEvent('error', type, { message: err.message, timestamp: new Date().toISOString() })
  })
}

async function doBootReal(): Promise<void> {
  if (!redisAvailable || !analysisQueue || !aiReportQueue || !connection) {
    logEvent('error', 'queue_unavailable', { message: 'workers not started, queue disabled' })
    return
  }

  // BullMQ manages concurrency — the engine processes one job at a time.
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
      // Single concurrency for the 512MB RAM free tier (WORKER_CONCURRENCY overrides).
      concurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
    },
  )
  attachWorkerErrorHandler(analysisWorker, 'worker_error')
  analysisWorker.on('stalled', (jobId) => {
    logEvent('warn', 'worker_stalled', { jobId, timestamp: new Date().toISOString() })
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
      concurrency: Number(process.env.REPORT_WORKER_CONCURRENCY) || 1,
    },
  )
  attachWorkerErrorHandler(reportWorker, 'ai_report_worker_error')

  // Handle jobs exhausting all retries (terminal-failure persistence).
  analysisEvents = new QueueEvents(ANALYSIS_QUEUE_NAME, { connection: connection! })
  analysisEvents.on('failed', async ({ jobId, failedReason }) => {
    await handleAnalysisFailure({ jobId, failedReason }, (id) => analysisQueue!.getJob(id), {
      markEngineJobFailed,
      getJob,
      persistAnalysisStatus,
    })
  })
  analysisEvents.on('error', (err) => {
    logEvent('error', 'queue_events_error', {
      queue: ANALYSIS_QUEUE_NAME,
      message: err.message,
      timestamp: new Date().toISOString(),
    })
  })

  reportEvents = new QueueEvents(REPORT_QUEUE_NAME, { connection: connection! })
  reportEvents.on('failed', async ({ jobId, failedReason }) => {
    await handleReportFailure({ jobId, failedReason }, (id) => aiReportQueue!.getJob(id), {
      updateAiReportJob,
    })
  })
  reportEvents.on('error', (err) => {
    logEvent('error', 'queue_events_error', {
      queue: REPORT_QUEUE_NAME,
      message: err.message,
      timestamp: new Date().toISOString(),
    })
  })

  analysisQueue.on('error', (err) => {
    logEvent('error', 'queue_error', { message: err.message, timestamp: new Date().toISOString() })
  })
  aiReportQueue.on('error', (err) => {
    logEvent('error', 'ai_report_queue_error', {
      message: err.message,
      timestamp: new Date().toISOString(),
    })
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
    logEvent('error', 'worker_boot_error', {
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
})

export async function shutdownWorkers(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logEvent('info', 'shutdown_start', { signal, timestamp: new Date().toISOString() })

  const forceExit = setTimeout(() => {
    logEvent('error', 'shutdown_timeout', { signal })
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  try {
    sweeps?.stop()

    // Close in dependency order; only attach handles that actually exist.
    const stages: Closable[] = []
    if (analysisWorker) stages.push({ close: () => analysisWorker!.close() })
    if (reportWorker) stages.push({ close: () => reportWorker!.close() })
    if (analysisEvents) stages.push({ close: () => analysisEvents!.close() })
    if (reportEvents) stages.push({ close: () => reportEvents!.close() })
    if (analysisQueue) stages.push({ close: () => analysisQueue!.close() })
    if (aiReportQueue) stages.push({ close: () => aiReportQueue!.close() })
    if (connection) stages.push({ close: () => connection!.quit().then(() => undefined) })

    await shutdownInOrder(stages)
    await shutdownHistoryStore()
    logEvent('info', 'shutdown_complete', { signal, timestamp: new Date().toISOString() })
  } catch (err) {
    logEvent('error', 'shutdown_error', {
      error: err instanceof Error ? err.message : 'unknown',
    })
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
