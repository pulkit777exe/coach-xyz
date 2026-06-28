import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { getJob, getEngineJobStatus } from "../lib/jobs"
import { persistAnalysisStatus } from "../lib/supabaseHistory"

export default new Elysia().get("/api/job-status/:jobId", async ({ params, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    set.status = 404
    return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
  }

  // Read engine job status directly from Redis — no HTTP hop to engine
  const engineStatus = await getEngineJobStatus(serverJob.engine_job_id)

  if (!engineStatus) {
    // Job exists in server mapping but not in engine Redis
    // This can happen if the engine job expired or was never created
    set.status = 200
    return {
      job_id: serverJob.server_job_id,
      state: "failed",
      stage: -1,
      stage_name: "Failed",
      progress: 0,
      complete: true,
      summary: null,
      video_ready: false,
      error: "Analysis job expired or was not found in the engine.",
      error_code: "JOB_NOT_FOUND",
      retryable: true,
    }
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
