import { getEngineJobStatus, markEngineJobFailed, type EngineStatusResult } from "./engine"

import type { EnginePipelineState } from "../types"

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

export interface EngineJobStatus {
  job_id: string
  state: EnginePipelineState
  stage: number
  stage_name: string
  progress: number
  summary: unknown | null
  video_ready: boolean
  created_at: string | null
  error: string | null
  error_code: string | null
  retryable: boolean
  complete: boolean
}

// Re-import redis for raw operations (rate limiting, etc.)
import { redis } from "./redis"

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
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      console.error(JSON.stringify({
        type: "job_json_corrupt",
        serverJobId,
        timestamp: new Date().toISOString(),
      }))
      return null
    }
  }
  return raw as ServerJob
}

// Read engine job status via HTTP (no direct Redis coupling)
export async function fetchEngineJobStatus(
  engineJobId: string,
): Promise<EngineStatusResult> {
  return getEngineJobStatus(engineJobId)
}

// Mark engine job as failed via HTTP (no direct Redis coupling)
export async function markJobFailed(
  engineJobId: string,
  message: string,
  code: string,
  retryable: boolean,
): Promise<void> {
  await markEngineJobFailed(engineJobId, message, code, retryable)
}

