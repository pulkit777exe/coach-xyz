import type { AnalysisJob } from "../types"

const JOB_TTL_MS = 2 * 60 * 60 * 1000
const jobs = new Map<string, AnalysisJob>()

const pruneExpiredJobs = () => {
  const now = Date.now()

  for (const [jobId, job] of jobs.entries()) {
    if (now - job.created_at > JOB_TTL_MS) {
      jobs.delete(jobId)
    }
  }
}

export const createJob = (data: Omit<AnalysisJob, "created_at">): AnalysisJob => {
  pruneExpiredJobs()

  const job: AnalysisJob = {
    ...data,
    created_at: Date.now(),
  }

  jobs.set(job.job_id, job)
  return job
}

export const getJob = (jobId: string): AnalysisJob | null => {
  pruneExpiredJobs()
  return jobs.get(jobId) ?? null
}

export const deleteJob = (jobId: string): void => {
  pruneExpiredJobs()
  jobs.delete(jobId)
}
