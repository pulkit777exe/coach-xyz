import { Queue, Worker, QueueEvents } from "bullmq"
import IORedis from "ioredis"
import { markJobFailed } from "./jobs"
import { shutdownHistoryStore } from "./supabaseHistory"

const ioredisUrl = process.env.UPSTASH_REDIS_IOREDIS_URL
const redisAvailable = !!ioredisUrl

let connection: IORedis | null = null
if (redisAvailable) {
  const useTls = ioredisUrl!.startsWith("rediss://")
  connection = new IORedis(
    ioredisUrl!,
    { maxRetriesPerRequest: null, ...(useTls ? { tls: {} } : {}) },
  )
}

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

// ── Keep-Alive Ping (Prevent Free Tier Spin-Down) ─────────────────────────
// On Render free tier, services spin down after 15 min inactivity.
// Ping our own health endpoint every 10 min to keep it alive.
if (process.env.NODE_ENV === "production") {
  const KEEPALIVE_INTERVAL = 10 * 60 * 1000 // 10 minutes
  const port = process.env.PORT || 8000

  setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) {
        console.log(JSON.stringify({ type: "keepalive", status: "ok" }))
      }
    } catch {
      // Ignore errors - service might be starting up
    }
  }, KEEPALIVE_INTERVAL)

  console.log(JSON.stringify({ type: "keepalive_enabled", interval: "10m" }))
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
        // Single concurrency for 512MB RAM free tier
        concurrency: 1,
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
