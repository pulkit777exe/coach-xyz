// ── Worker lifecycle ─────────────────────────────────────────────────────────
// The durable queue is Postgres (`server_jobs`, SKIP-LOCKED claims). No Redis,
// no BullMQ: boot starts a bounded drain loop, sweeps and signal handlers via
// ONE explicit bootWorkers() call from index.ts. Enqueue must work before
// boot, so the drain timer only starts during boot while stores are usable.
//
// The job adapters (retry mapping, processors, sweeps, shutdown helpers) are
// dependency-injected and live in ./workerJobs so tests can run them without
// live infra. They are re-exported here to keep the single import surface used
// by routes and tests.
import { randomUUID } from 'crypto'

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
import { notifyAnalysisOutcome } from './notificationsEvents'
import {
  JOB_PRIORITY,
  SHUTDOWN_TIMEOUT_MS,
  STUCK_TIMEOUT_MS,
  classifyProcessorError,
  createIdempotentBoot,
  getAnalysisWorkerConcurrency,
  getReportWorkerConcurrency,
  handleAnalysisFailure,
  handleReportFailure,
  pruneOldAnalyses,
  runAiReportProcessor,
  runAnalysisProcessor,
  startSweeps,
  UnrecoverableError,
} from './workerJobs'
import {
  claimDueJobs,
  completeJob,
  enqueueDurableJob,
  failJob,
  failStuckJobs,
  pruneTerminalJobs,
  queueCounts,
  reclaimStuckJobs,
  retryDelayMs,
} from './serverJobsStore'
import type { AiReportPayload, AnalysisPayload } from './workerJobs'

export * from './workerJobs'

const ANALYSIS_POLL_MS = Math.max(200, Number(process.env.ANALYSIS_QUEUE_POLL_MS) || 1000)
const ANALYSIS_DRAIN_BATCH = Math.max(1, Number(process.env.ANALYSIS_DRAIN_BATCH) || 4)
const REPORT_DRAIN_BATCH = Math.max(1, Number(process.env.REPORT_DRAIN_BATCH) || 2)
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

let drainTimer: ReturnType<typeof setInterval> | null = null
let shuttingDown = false

// ── Enqueue paths ────────────────────────────────────────────────────────────

/** Shared enqueue path for analyze-video and me/analyze-video. */
export async function enqueueAnalysis(job: AnalysisPayload): Promise<void> {
  // The analysis row is already written by admission (persistAnalysisStart);
  // this upsert is the safety net for enqueue paths that bypass admission.
  await saveJob({
    server_job_id: job.server_job_id,
    engine_job_id: job.engine_job_id,
    session_token: job.session_token,
    player_index: job.player_index,
    model: DEFAULT_MODEL,
    created_at: Date.now(),
    owner_ids: job.owner_ids ?? [],
  })
  await enqueueDurableJob('analysis', job.server_job_id, { ...job }, {
    priority: job.priority ?? JOB_PRIORITY,
    maxAttempts: 3,
  })
}

/** Create a queued report job record and enqueue the durable job. */
export const enqueueAiReport = async (
  payload: Omit<AiReportPayload, 'report_job_id'>,
): Promise<string | null> => {
  const reportJobId = randomUUID()
  await initAiReportJob({ report_job_id: reportJobId, auth0_id: payload.auth0_id })
  await enqueueDurableJob('ai_report', reportJobId, { ...payload, report_job_id: reportJobId }, {
    maxAttempts: 3,
  })
  return reportJobId
}

// ── Job processing ───────────────────────────────────────────────────────────

type ClaimedAnalysis = {
  key: string
  payload: AnalysisPayload
  attempts: number
  max_attempts: number
}
type ClaimedReport = {
  key: string
  payload: AiReportPayload
  attempts: number
  max_attempts: number
}

const notifyFailure = async (
  payload: AnalysisPayload,
  reason: string,
  attempts = 3,
  maxAttempts = 3,
) => {
  await handleAnalysisFailure(
    { jobId: payload.server_job_id, failedReason: reason },
    async () => ({
      attemptsMade: attempts,
      opts: { attempts: maxAttempts },
      data: payload,
    }),
    { markEngineJobFailed, getJob, persistAnalysisStatus },
    DEFAULT_MODEL,
  )
  await notifyAnalysisOutcome(payload.server_job_id, payload.engine_job_id, 'failed')
}

async function processAnalysisJob(job: ClaimedAnalysis): Promise<void> {
  const payload = job.payload
  try {
    await runAnalysisProcessor(payload, async () => 'processing', {
      analyzeVideo,
      getEngineJobStatus,
      getJob,
      persistAnalysisStatus,
    }, DEFAULT_MODEL)
    await completeJob('analysis', job.key)
    await notifyAnalysisOutcome(payload.server_job_id, payload.engine_job_id, 'completed')
  } catch (error) {
    const mapped = classifyProcessorError(error)
    const permanent = error instanceof UnrecoverableError || !mapped.retryable
    const status = await failJob('analysis', job.key, {
      message: `${mapped.code}: ${mapped.message}`,
      permanent,
    })
    if (status === 'failed') {
      await notifyFailure(
        payload,
        `${mapped.code}: ${mapped.message}`,
        job.attempts,
        job.max_attempts,
      )
      logEvent('error', 'analysis_job_failed', {
        engine_job_id: payload.engine_job_id,
        code: mapped.code,
        server_job_id: payload.server_job_id,
      })
    } else {
      logEvent('warn', 'analysis_job_retry_scheduled', {
        engine_job_id: payload.engine_job_id,
        attempt: job.attempts,
        max_attempts: job.max_attempts,
        retry_in_ms: retryDelayMs(job.attempts + 1),
      })
    }
  }
}

async function processReportJob(job: ClaimedReport): Promise<void> {
  const payload = job.payload
  try {
    await runAiReportProcessor(payload, async () => 'processing', {
      generateAiReport,
      updateAiReportJob,
      persistAiReportRecord,
    })
    await completeJob('ai_report', job.key)
  } catch (error) {
    const mapped = classifyProcessorError(error, 'Unknown AI report error.')
    const permanent = error instanceof UnrecoverableError || !mapped.retryable
    const status = await failJob('ai_report', job.key, {
      message: `${mapped.code}: ${mapped.message}`,
      permanent,
    })
    if (status === 'failed') {
      await handleReportFailure(
        { jobId: job.key, failedReason: `${mapped.code}: ${mapped.message}` },
        async () => ({
          attemptsMade: job.attempts,
          opts: { attempts: job.max_attempts },
          data: { report_job_id: payload.report_job_id },
        }),
        { updateAiReportJob },
      )
      logEvent('error', 'ai_report_job_failed', {
        report_job_id: payload.report_job_id,
        code: mapped.code,
      })
    }
  }
}

async function drain(): Promise<void> {
  if (shuttingDown) return
  const analysisBatch = Math.max(1, Math.min(ANALYSIS_DRAIN_BATCH, getAnalysisWorkerConcurrency()))
  const reportBatch = Math.max(1, Math.min(REPORT_DRAIN_BATCH, getReportWorkerConcurrency()))
  const [claimedAnalysis, claimedReports] = await Promise.all([
    claimDueJobs<AnalysisPayload>('analysis', analysisBatch),
    claimDueJobs<AiReportPayload>('ai_report', reportBatch),
  ])
  await Promise.allSettled([
    ...claimedAnalysis.map((job) =>
      processAnalysisJob({
        key: job.key,
        payload: job.payload,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
      })),
    ...claimedReports.map((job) =>
      processReportJob({
        key: job.key,
        payload: job.payload,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
      })),
  ])
}

function startDrainTimer(): void {
  if (drainTimer) return
  drainTimer = setInterval(() => {
    void drain().catch((err) => {
      logEvent('error', 'queue_drain_error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, ANALYSIS_POLL_MS)
  drainTimer.unref()
}

// ── Boot / shutdown ──────────────────────────────────────────────────────────

let sweeps: { stop: () => void } | null = null

const runStuckRecovery = async () => {
  let reclaimed = 0
  for (const kind of ['analysis', 'ai_report'] as const) {
    reclaimed += (await reclaimStuckJobs(kind, STUCK_TIMEOUT_MS)).length
  }
  for (const job of await failStuckJobs('analysis', STUCK_TIMEOUT_MS)) {
    const payload = job.payload as unknown as AnalysisPayload
    await notifyFailure(payload, 'Job exceeded the 13 minute timeout.', job.attempts, job.max_attempts)
    reclaimed += 1
  }
  for (const job of await failStuckJobs('ai_report', STUCK_TIMEOUT_MS)) {
    await handleReportFailure(
      { jobId: job.key, failedReason: 'AI report exceeded the 13 minute timeout.' },
      async () => ({
        attemptsMade: job.attempts,
        opts: { attempts: job.max_attempts },
        data: { report_job_id: (job.payload as { report_job_id?: string }).report_job_id },
      }),
      { updateAiReportJob },
    )
    reclaimed += 1
  }
  if (reclaimed > 0) {
    logEvent('info', 'stuck_jobs_reclaimed', { count: reclaimed })
  }
  await pruneTerminalJobs(TERMINAL_RETENTION_MS)
}

function registerSignalHandlers(): void {
  const handle = (signal: string) => {
    void shutdownWorkers(signal)
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => handle(signal))
  }
}

const doBootReal = async () => {
  startDrainTimer()
  sweeps = startSweeps(
    () => {
      void runStuckRecovery()
    },
    () => {
      void pruneOldAnalyses()
    },
  )
  registerSignalHandlers()
  // Drain immediately so work enqueued before boot does not wait for the first tick.
  void drain()
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
    if (drainTimer) {
      clearInterval(drainTimer)
      drainTimer = null
    }
    sweeps?.stop()
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
  return queueCounts('analysis')
}
