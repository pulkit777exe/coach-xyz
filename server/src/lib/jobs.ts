import { redis } from './redis'
import { logger } from './logger'

const KEY = 'coachai:srv:'
const JOB_TTL = 7200

export interface ServerJob {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  created_at: number
  /** Verified subs authorized to read this job (owner set). Empty/missing =
   * anonymous job — readable by bearer job id (demo/landing flow). */
  owner_ids?: string[]
}

export async function saveJob(job: ServerJob): Promise<void> {
  await redis.set(`${KEY}${job.server_job_id}`, JSON.stringify(job), {
    ex: JOB_TTL,
  })
}

export async function getJob(serverJobId: string): Promise<ServerJob | null> {
  const raw = await redis.get(`${KEY}${serverJobId}`)
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      logger.error('job_json_corrupt', {
        type: 'job_json_corrupt',
        serverJobId,
      })
      return null
    }
  }
  return raw as ServerJob
}
