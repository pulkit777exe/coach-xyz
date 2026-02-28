import { Elysia } from "elysia"

import { getJobStatus } from "../lib/engine"
import { buildError } from "../lib/errors"
import { getJob } from "../lib/jobs"

type EngineRouteError = {
  code?: string
  message?: string
}

export default new Elysia().get("/api/job-status/:jobId", async ({ params, set }) => {
  const job = getJob(params.jobId)

  if (!job) {
    set.status = 404
    return buildError("JOB_NOT_FOUND")
  }

  try {
    const status = await getJobStatus(job.engine_job_id)
    set.status = 200
    return status
  } catch (error) {
    const routeError = error as EngineRouteError
    set.status = 503
    return buildError("ENGINE_UNAVAILABLE", routeError.message)
  }
})
