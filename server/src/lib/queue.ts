import { Queue, Worker, QueueEvents } from "bullmq"
import { markJobFailed } from "./jobs"
import { shutdownHistoryStore } from "./supabaseHistory"

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

  // Dynamically import ioredis to avoid crash when not needed
  try {
    const IORedis = require("ioredis")
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      tls: {},
      // Upstash recommended settings for serverless
      enableReadyCheck: false,
      lazyConnect: true,
    })
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
  beta: 10,      // Beta users get highest priority
  paid: 5,       // Paid users (future)
  free: 0,       // Free users (default)
} as const

export type JobPriority = keyof typeof JOB_PRIORITIES

// ── Keep-Alive Ping (Prevent Free Tier Spin-Down) ─────────────────────────
// On Render free tier, services spin down after 15 min inactivity.
// Ping our own health endpoint AND the engine every 10 min to keep both alive.
if (process.env.NODE_ENV === "production") {
  const KEEPALIVE_INTERVAL = 10 * 60 * 1000 // 10 minutes
  const port = process.env.PORT || 8000
  const engineUrl = process.env.ENGINE_URL ?? "http://localhost:8001"

  // Keep server alive
  setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) {
        console.log(JSON.stringify({ type: "keepalive", target: "server", status: "ok" }))
      }
    } catch {
      // Ignore errors - service might be starting up
    }
  }, KEEPALIVE_INTERVAL)

  // Keep engine alive
  setInterval(async () => {
    try {
      const res = await fetch(`${engineUrl}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        console.log(JSON.stringify({ type: "keepalive", target: "engine", status: "ok" }))
      }
    } catch {
      // Ignore errors - engine might be starting up
    }
  }, KEEPALIVE_INTERVAL)

  console.log(JSON.stringify({ type: "keepalive_enabled", interval: "10m", targets: ["server", "engine"] }))
}

export interface AnalysisPayload {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
}

// The worker calls the engine synchronously.
// BullMQ manages concurrency — engine processes one job at a time.
const worker = redisAvailable
  ? new Worker<AnalysisPayload>(
      "coachai-analysis",
      async (job) => {
        const { engine_job_id, session_token, player_index } = job.data

        const res = await fetch(
          `${process.env.ENGINE_URL}/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              engine_job_id,
              session_token,
              player_index,
            }),
            signal: AbortSignal.timeout(12 * 60 * 1000), // 12 min max
          },
        )

        if (!res.ok) {
          const body: any = await res.json().catch(() => ({}))
          // Create an error with engine's code and message for proper propagation
          const err = new Error(body.message ?? `Engine error ${res.status}`)
          ;(err as any).code = body.code ?? "ENGINE_ERROR"
          ;(err as any).retryable = body.retryable ?? true
          throw err
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

// Handle job exhausting all retries
if (redisAvailable && analysisQueue) {
  const queueEvents = new QueueEvents("coachai-analysis", { connection: connection as any })

  queueEvents.on("failed", async ({ jobId }) => {
    const bullJob = await analysisQueue!.getJob(jobId)
    if (!bullJob?.data?.engine_job_id) return

    // Only mark failed after ALL retries exhausted
    if ((bullJob.attemptsMade ?? 0) >= (bullJob.opts?.attempts ?? 3)) {
      await markJobFailed(
        bullJob.data.engine_job_id,
        "Analysis failed after 3 attempts. Please try again.",
        "ANALYSIS_FAILED",
        true,
      )
      console.error(
        JSON.stringify({
          type: "job_exhausted",
          engine_job_id: bullJob.data.engine_job_id,
          attempts: bullJob.attemptsMade,
        }),
      )
    }
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
            new Error("Job exceeded 15 minute timeout"),
            "0",
            true,
          )
        }
      }
    } catch (err) {
      console.error("Stuck job recovery error:", err)
    }
  }

  setInterval(recoverStuckJobs, 10 * 60 * 1000)
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
