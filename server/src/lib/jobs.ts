import { redis } from "./redis"

const KEY = "coachai:srv:"
const JOB_TTL = 7200

interface ServerJob {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  created_at: number
}

export async function saveJob(job: ServerJob): Promise<void> {
  await redis.set(
    `${KEY}${job.server_job_id}`,
    JSON.stringify(job),
    { ex: JOB_TTL },
  )
}

export async function getJob(
  serverJobId: string,
): Promise<ServerJob | null> {
  const raw = await redis.get(`${KEY}${serverJobId}`)
  if (!raw) return null
  return typeof raw === "string" ? JSON.parse(raw) : raw
}

// Read engine job status directly from Redis
// Avoids an HTTP hop to the engine just to check progress
export async function getEngineJobStatus(
  engineJobId: string,
): Promise<any> {
  const raw = await redis.get(`coachai:job:${engineJobId}`)
  if (!raw) return null
  return typeof raw === "string" ? JSON.parse(raw) : raw
}

export async function markJobFailed(
  engineJobId: string,
  message: string,
  code: string,
  retryable: boolean,
): Promise<void> {
  const raw = await redis.get(`coachai:job:${engineJobId}`)
  if (!raw) return
  const job = typeof raw === "string" ? JSON.parse(raw) : raw
  await redis.set(
    `coachai:job:${engineJobId}`,
    JSON.stringify({
      ...job,
      state: "failed",
      complete: true,
      error: message,
      error_code: code,
      retryable,
    }),
    { ex: JOB_TTL },
  )
}

export { redis }
