import { Queue, Worker, QueueEvents, UnrecoverableError } from "bullmq"
import { markJobFailed, getJob } from "./jobs"
import { shutdownHistoryStore, persistAnalysisStatus } from "./supabaseHistory"
import { wrapEngineError } from "./errors"
import type { CoachAIError } from "./errors"
import { ENGINE_URL } from "./engine"

// Non-retryable engine error codes — these will never succeed on retry.
// Note: The engine sets retryable per-error; these codes are inherently
// non-retryable regardless of the engine's retryable flag.
const UNRECOVERABLE_CODES = new Set([
  "VIDEO_DECODE_FAILED",
  "VIDEO_EXPIRED",
  "VIDEO_NOT_FOUND",
  "JOB_NOT_FOUND",
  "INVALID_REQUEST",
  "MEDIAPIPE_UNAVAILABLE",
])

// Derive Redis protocol URL from Upstash REST URL and token
// REST URL format: https://<endpoint>.upstash.io
// Redis protocol format: rediss://default:<token>@<endpoint>.upstash.io:6379
function getRedisConnection() {
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
    const IORedis = require("ioredis")
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
    client.on("error", (err: Error) => {
      console.error(JSON.stringify({ type: "redis_error", source: "queue", message: err.message }))
    })
    client.on("reconnecting", (delay: number) => {
      console.warn(JSON.stringify({ type: "redis_reconnecting", source: "queue", delay_ms: delay }))
    })
    return client
  } catch {
    console.error(JSON.stringify({ type: "queue_unavailable", message: "ioredis not available, queue disabled" }))
    return null
  }
}

const connection = getRedisConnection()
const redisAvailable = !!connection

export const analysisQueue = redisAvailable
  ? new Queue("coachai-analysis", {
      connection: connection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    })
  : null

// Job priority configuration
// Higher number = higher priority
export const JOB_PRIORITIES = {
  paid: 5,       // Paid users (future)
  free: 0,       // Free users (default)
} as const

export type JobPriority = keyof typeof JOB_PRIORITIES

// ── Keep-Alive Ping (Prevent Free Tier Spin-Down) ─────────────────────────
// On Render free tier, services spin down after 15 min inactivity.
// Ping our own health endpoint AND the engine every 10 min to keep both alive.
const KEEPALIVE_INTERVAL = 10 * 60 * 1000 // 10 minutes
let keepAliveServerTimer: ReturnType<typeof setInterval> | null = null
let keepAliveEngineTimer: ReturnType<typeof setInterval> | null = null

if (process.env.NODE_ENV === "production") {
  const port = process.env.PORT || 8000

  // Keep server alive
  keepAliveServerTimer = setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        console.log(JSON.stringify({ type: "keepalive", target: "server", status: "ok" }))
      }
    } catch {
      // Ignore errors - service might be starting up
    }
  }, KEEPALIVE_INTERVAL)
  keepAliveServerTimer.unref()

  // Keep engine alive
  keepAliveEngineTimer = setInterval(async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        console.log(JSON.stringify({ type: "keepalive", target: "engine", status: "ok" }))
      }
    } catch {
      // Ignore errors - engine might be starting up
    }
  }, KEEPALIVE_INTERVAL)
  keepAliveEngineTimer.unref()

  console.log(JSON.stringify({ type: "keepalive_enabled", interval: "10m", targets: ["server", "engine"] }))
}

export interface AnalysisPayload {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  video_key: string | null
}

// The worker calls the engine synchronously.
// BullMQ manages concurrency — engine processes one job at a time.
const worker = redisAvailable
  ? new Worker<AnalysisPayload>(
      "coachai-analysis",
      async (job) => {
        const { engine_job_id, session_token, player_index, video_key } = job.data

        // Idempotency check: skip if job already processed (race with status poll)
        const existingJob = await job.getState()
        if (existingJob === "completed" || existingJob === "failed") {
          return { ok: true, skipped: "already_terminal" }
        }

        const res = await fetch(
          `${ENGINE_URL}/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              engine_job_id,
              session_token,
              player_index,
              video_key,
            }),
            signal: AbortSignal.timeout(12 * 60 * 1000), // 12 min max
          },
        )

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Partial<CoachAIError>
          const engineError = wrapEngineError(body)

          // Non-retryable errors: throw UnrecoverableError to stop retries
          if (UNRECOVERABLE_CODES.has(engineError.code)) {
            throw new UnrecoverableError(
              `${engineError.code}: ${engineError.message}`,
            )
          }

          throw engineError
        }

        // Persist completed status immediately so history is accurate even if
        // the client never polls again (browser closed, network drop, etc.)
        try {
          const { getEngineJobStatus } = await import("./engine")
          const statusResult = await getEngineJobStatus(engine_job_id)
          if (statusResult.status === "found") {
            const engineStatus = statusResult.data
            const serverJob = await getJob(job.data.server_job_id)
            await persistAnalysisStatus({
              serverJobId: job.data.server_job_id,
              engineJobId: engine_job_id,
              sessionToken: job.data.session_token,
              playerIndex: job.data.player_index,
              model: serverJob?.model ?? "gemini-2.5-flash",
              status: {
                stage: engineStatus.stage ?? 6,
                stage_name: engineStatus.stage_name ?? "Complete",
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
          console.error(JSON.stringify({
            type: "worker_completion_persist_error",
            engine_job_id,
            error: persistErr instanceof Error ? persistErr.message : "unknown",
            timestamp: new Date().toISOString(),
          }))
        }

        return { ok: true }
      },
      {
        connection: connection as any,
        // Single concurrency for 512MB RAM free tier (configurable via WORKER_CONCURRENCY)
        concurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
      },
    )
  : null

// Worker health event handlers
if (worker) {
  worker.on("error", (err) => {
    console.error(JSON.stringify({
      type: "worker_error",
      message: err.message,
      timestamp: new Date().toISOString(),
    }))
  })
  worker.on("stalled", (jobId) => {
    console.warn(JSON.stringify({
      type: "worker_stalled",
      jobId,
      timestamp: new Date().toISOString(),
    }))
  })
}

// Handle job exhausting all retries
let queueEvents: QueueEvents | null = null
if (redisAvailable && analysisQueue) {
  queueEvents = new QueueEvents("coachai-analysis", { connection: connection as any })

  queueEvents.on("failed", async ({ jobId, failedReason }) => {
    try {
      const bullJob = await analysisQueue!.getJob(jobId)
      if (!bullJob?.data?.engine_job_id) return

      const isUnrecoverable = failedReason?.includes("UnrecoverableError")
      const retriesExhausted = (bullJob.attemptsMade ?? 0) >= (bullJob.opts?.attempts ?? 3)

      // Mark failed if: retries exhausted OR unrecoverable error
      if (retriesExhausted || isUnrecoverable) {
        // Extract error code from UnrecoverableError message if present
        let errorCode = "ANALYSIS_FAILED"
        let retryable = true
        if (isUnrecoverable && failedReason) {
          const match = failedReason.match(/^(\w+):/)
          if (match) {
            errorCode = match[1]
            retryable = false
          }
        }

        await markJobFailed(
          bullJob.data.engine_job_id,
          isUnrecoverable ? failedReason : "Analysis failed after retries. Please try again.",
          errorCode,
          retryable,
        )

        // Persist failed status to history so it appears even if client stops polling
        try {
          const serverJob = await getJob(bullJob.data.server_job_id)
          await persistAnalysisStatus({
            serverJobId: bullJob.data.server_job_id,
            engineJobId: bullJob.data.engine_job_id,
            sessionToken: bullJob.data.session_token,
            playerIndex: bullJob.data.player_index,
            model: serverJob?.model ?? "gemini-2.5-flash",
            status: {
              stage: -1,
              stage_name: "Failed",
              progress: 0,
              complete: true,
              video_ready: false,
              summary: null,
              error: isUnrecoverable ? failedReason : "Analysis failed after retries. Please try again.",
              error_code: errorCode,
              retryable,
            },
          })
        } catch (persistErr) {
          console.error(JSON.stringify({
            type: "failed_persist_history_error",
            engine_job_id: bullJob.data.engine_job_id,
            error: persistErr instanceof Error ? persistErr.message : "unknown",
            timestamp: new Date().toISOString(),
          }))
        }

        console.error(
          JSON.stringify({
            type: isUnrecoverable ? "job_unrecoverable" : "job_exhausted",
            engine_job_id: bullJob.data.engine_job_id,
            attempts: bullJob.attemptsMade,
            error_code: errorCode,
          }),
        )
      }
    } catch (err) {
      console.error(JSON.stringify({
        type: "failed_event_handler_error",
        jobId,
        error: err instanceof Error ? err.message : "unknown",
        timestamp: new Date().toISOString(),
      }))
    }
  })

  // Queue-level error handler
  analysisQueue.on("error", (err) => {
    console.error(JSON.stringify({
      type: "queue_error",
      message: err.message,
      timestamp: new Date().toISOString(),
    }))
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
              type: "stuck_job",
              engine_job_id: job.data.engine_job_id,
              age_minutes: Math.round(age / 60000),
            }),
          )
          await job.moveToFailed(
            new UnrecoverableError("Job exceeded 13 minute timeout"),
            job.token ?? "0",
            true,
          )
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ type: "stuck_job_recovery_error", error: String(err) }))
    }
  }

  const stuckRecoveryInterval = setInterval(recoverStuckJobs, 10 * 60 * 1000)
  stuckRecoveryInterval.unref()
  setTimeout(recoverStuckJobs, 30_000)
}

// ── Graceful Shutdown ──────────────────────────────────────────────────────
// Per BullMQ docs: must close both worker AND queue (each creates own Redis connection)
const SHUTDOWN_TIMEOUT_MS = 10_000

const gracefulShutdown = async (signal: string) => {
  console.log(JSON.stringify({ type: "shutdown_start", signal, timestamp: new Date().toISOString() }))

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ type: "shutdown_timeout", signal }))
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  try {
    // Clear all intervals to prevent firing after shutdown
    if (keepAliveServerTimer) clearInterval(keepAliveServerTimer)
    if (keepAliveEngineTimer) clearInterval(keepAliveEngineTimer)

    if (queueEvents) await queueEvents.close()
    if (worker) await worker.close()
    if (analysisQueue) await analysisQueue.close()
    if (connection) await connection.quit()
    await shutdownHistoryStore()
    console.log(JSON.stringify({ type: "shutdown_complete", signal, timestamp: new Date().toISOString() }))
  } catch (err) {
    console.error(JSON.stringify({ type: "shutdown_error", error: err instanceof Error ? err.message : "unknown" }))
  }
  process.exit(0)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

export { worker }
