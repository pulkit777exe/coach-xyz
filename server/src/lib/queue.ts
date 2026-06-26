import { Queue, Worker, QueueEvents } from "bullmq"
import IORedis from "ioredis"
import { markJobFailed } from "./jobs"

// BullMQ needs ioredis, not @upstash/redis
const ioredisUrl = process.env.UPSTASH_REDIS_IOREDIS_URL!
const useTls = ioredisUrl.startsWith("rediss://")
const connection = new IORedis(
  ioredisUrl,
  { maxRetriesPerRequest: null, ...(useTls ? { tls: {} } : {}) },
)

export const analysisQueue = new Queue("coachai-analysis", {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
})

export interface AnalysisPayload {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
}

// The worker calls the engine synchronously.
// BullMQ manages concurrency — engine processes one job at a time.
const worker = new Worker<AnalysisPayload>(
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
      // Throwing causes BullMQ to retry
      throw new Error(body.message ?? `Engine error ${res.status}`)
    }

    return { ok: true }
  },
  {
    connection: connection as any,
    // CRITICAL: concurrency=2 means max 2 simultaneous engine calls
    // On HuggingFace free tier (16GB RAM): safe for 2 MediaPipe instances
    // Each MediaPipe instance ~300MB + Gemini calls ~100MB = ~800MB per job
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  },
)

// Handle job exhausting all retries
const queueEvents = new QueueEvents("coachai-analysis", { connection: connection as any })

queueEvents.on("failed", async ({ jobId }) => {
  const bullJob = await analysisQueue.getJob(jobId)
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
    const active = await analysisQueue.getActive()
    const STUCK_MS = 15 * 60 * 1000 // 15 minutes

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

export { worker }
