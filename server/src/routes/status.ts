import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { getJob } from "../lib/jobs"
import { verifyJobAccess } from "../lib/jobAccess"
import { getEngineJobStatus, requestIdFrom } from "../lib/engine"
import { redactWellness, resolveMedicalAccess } from "../lib/permissions"
import { persistAnalysisStatus, getAnalysisByServerJobId } from "../lib/supabaseHistory"

type StatusResponse = {
  job_id: string
  state: string
  stage: number
  stage_name: string
  progress: number
  complete: boolean
  summary: unknown
  video_ready: boolean
  error: string | null
  error_code: string | null
  retryable: boolean
}

const statusResponse = (jobId: string, overrides: Partial<StatusResponse>): StatusResponse => ({
  job_id: jobId,
  state: "scanning",
  stage: 0,
  stage_name: "Queued",
  progress: 0,
  complete: false,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: true,
  ...overrides,
})

export default new Elysia().get("/api/job-status/:jobId", async ({ params, request, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    // Redis key expired — check Supabase for persisted analysis
    const persisted = await getAnalysisByServerJobId(params.jobId)
    if (persisted) {
      const access = verifyJobAccess(request, null, persisted)
      if (!access.ok) {
        set.status = access.status
        return access.body
      }
      // Wellness signals stay behind the medical boundary (§5).
      const maySee = await resolveMedicalAccess(persisted.auth0_id, access.callerSub)
      set.status = 200
      return statusResponse(params.jobId, {
        state: persisted.complete ? "completed" : "failed",
        stage: persisted.stage ?? -1,
        stage_name: persisted.stage_name ?? (persisted.complete ? "Complete" : "Failed"),
        progress: persisted.progress ?? 0,
        complete: persisted.complete,
        summary: maySee ? persisted.summary_json : redactWellness(persisted.summary_json),
        video_ready: persisted.video_ready,
        error: persisted.error_message,
        error_code: persisted.error_code,
        retryable: false,
      })
    }

    set.status = 404
    return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
  }

  const access = verifyJobAccess(request, serverJob)
  if (!access.ok) {
    set.status = access.status
    return access.body
  }

  // Read engine job status via HTTP (engine computes stage_name and video_ready)
  const result = await getEngineJobStatus(serverJob.engine_job_id, requestIdFrom(request))

  // Handle transient engine connectivity errors — don't permanently fail the job
  if (result.status === "transient_error") {
    // Return last known state or a "retrying" state, don't persist as failed
    set.status = 200
    return statusResponse(serverJob.server_job_id, {
      state: "scanning",  // Assume still processing
      stage: 1,
      stage_name: "Retrying...",
    })
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
    return statusResponse(serverJob.server_job_id, {
      state: "failed",
      stage: -1,
      stage_name: "Failed",
      complete: true,
      error: "Analysis job expired or was not found in the engine.",
      error_code: "JOB_NOT_FOUND",
    })
  }

  // Success case — engine returned status
  const engineStatus = result.data

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

  set.status = 200
  // Wellness signals stay behind the medical boundary (§5). The check runs
  // only when a summary exists; the persisted row names the owning account.
  let summary: unknown = engineStatus.summary
  if (summary) {
    const persisted = await getAnalysisByServerJobId(serverJob.server_job_id)
    const maySee = await resolveMedicalAccess(persisted?.auth0_id ?? null, access.callerSub)
    if (!maySee) summary = redactWellness(summary)
  }
  return statusResponse(serverJob.server_job_id, {
    state: engineStatus.state,
    stage: engineStatus.stage ?? -1,
    stage_name: stageName,
    progress: engineStatus.progress,
    complete: engineStatus.complete,
    summary,
    video_ready: videoReady,
    error: engineStatus.error,
    error_code: engineStatus.error_code,
    retryable: engineStatus.retryable,
  })
})
