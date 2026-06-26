import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { getJob, getEngineJobStatus } from "../lib/jobs"
import { persistAnalysisStatus } from "../lib/supabaseHistory"

export default new Elysia().get("/api/job-status/:jobId", async ({ params, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    set.status = 404
    return buildError("JOB_NOT_FOUND", undefined, false)
  }

  // Read engine job status directly from Redis — no HTTP hop to engine
  const engineStatus = await getEngineJobStatus(serverJob.engine_job_id)

  if (!engineStatus) {
    set.status = 404
    return buildError("JOB_NOT_FOUND", undefined, false)
  }

  await persistAnalysisStatus({
    serverJobId: serverJob.server_job_id,
    engineJobId: serverJob.engine_job_id,
    sessionToken: serverJob.session_token,
    playerIndex: serverJob.player_index,
    model: serverJob.model,
    status: engineStatus,
  })

  set.status = 200
  return engineStatus
})
