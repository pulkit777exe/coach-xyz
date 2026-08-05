import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { getJob, fetchEngineJobStatus, type EngineJobStatus } from "../lib/jobs"
import { persistAnalysisStatus, getAnalysisByServerJobId } from "../lib/supabaseHistory"

export default new Elysia().get("/api/job-status/:jobId", async ({ params, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    // Redis key expired — check Supabase for persisted analysis
    const persisted = await getAnalysisByServerJobId(params.jobId)
    if (persisted) {
      set.status = 200
      return {
        job_id: persisted.server_job_id,
        state: persisted.complete ? "completed" : "failed",
        stage: persisted.stage ?? -1,
        stage_name: persisted.stage_name ?? (persisted.complete ? "Complete" : "Failed"),
        progress: persisted.progress ?? 0,
        complete: persisted.complete,
        summary: persisted.summary_json,
        video_ready: persisted.video_ready,
        error: persisted.error_message,
        error_code: persisted.error_code,
        retryable: false,
      }
    }

    set.status = 404
    return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
  }

  // Read engine job status via HTTP (engine computes stage_name and video_ready)
  const result = await fetchEngineJobStatus(serverJob.engine_job_id)

  // Handle transient engine connectivity errors — don't permanently fail the job
  if (result.status === "transient_error") {
    // Return last known state or a "retrying" state, don't persist as failed
    set.status = 200
    return {
      job_id: serverJob.server_job_id,
      state: "scanning",  // Assume still processing
      stage: 1,
      stage_name: "Retrying...",
      progress: 0,
      complete: false,
      summary: null,
      video_ready: false,
      error: null,
      error_code: null,
      retryable: true,
    }
  }

  // Handle truly not found — the job expired or was never created
  if (result.status === "not_found") {
    // Persist the failed status before returning so it shows in history
    await persistAnalysisStatus({
      serverJobId: serverJob.server_job_id,
      engineJobId: serverJob.engine_job_id,
      sessionToken: serverJob.session_token,
      playerIndex: serverJob.player_index,
      model: serverJob.model,
      status: {
        stage: -1,
        stage_name: "Failed",
        progress: 0,
        complete: true,
        video_ready: false,
        summary: null,
        error: "Analysis job expired or was not found in the engine.",
        error_code: "JOB_NOT_FOUND",
        retryable: true,
      },
    })

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

  // Success case — engine returned status
  const engineStatus: EngineJobStatus = result.data

  // Engine returns stage_name and video_ready as computed fields
  const stageName = engineStatus.stage_name ?? engineStatus.state
  const videoReady = engineStatus.video_ready

  await persistAnalysisStatus({
    serverJobId: serverJob.server_job_id,
    engineJobId: serverJob.engine_job_id,
    sessionToken: serverJob.session_token,
    playerIndex: serverJob.player_index,
    model: serverJob.model,
    status: {
      stage: engineStatus.stage ?? -1,
      stage_name: stageName,
      progress: engineStatus.progress,
      complete: engineStatus.complete,
      video_ready: videoReady,
      summary: engineStatus.summary,
      error: engineStatus.error ?? null,
      error_code: engineStatus.error_code ?? null,
      retryable: engineStatus.retryable ?? true,
    },
  })

  // Whitelist safe fields for client
  const safeStatus = {
    job_id: serverJob.server_job_id,
    state: engineStatus.state,
    stage: engineStatus.stage,
    stage_name: stageName,
    progress: engineStatus.progress,
    complete: engineStatus.complete,
    summary: engineStatus.summary,
    video_ready: videoReady,
    error: engineStatus.error,
    error_code: engineStatus.error_code,
    retryable: engineStatus.retryable,
  }
  set.status = 200
  return safeStatus
})
