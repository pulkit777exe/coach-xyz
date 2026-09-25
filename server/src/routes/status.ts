import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import type { ServerJob } from '../lib/jobs'
import { verifyJobAccess } from '../lib/jobAccess'
import { getEngineJobStatus, requestIdFrom } from '../lib/engine'
import { redactWellness, resolveMedicalAccess } from '../lib/permissions'
import { persistAnalysisStatus, getAnalysisByServerJobId, getAnalysisOwner } from '../lib/analyses'
import { buildFailedAnalysisStatus } from '../lib/queue'

export type StatusResponse = {
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

/** Everything the status snapshot touches externally, so tests can stub stores. */
export type StatusRouteDeps = {
  getJob?: (jobId: string) => Promise<ServerJob | null>
  getAnalysisByServerJobId?: typeof getAnalysisByServerJobId
  persistAnalysisStatus?: typeof persistAnalysisStatus
}

export type StatusResolution =
  { ok: true; response: StatusResponse } | { ok: false; status: number; body: unknown }

export const statusResponse = (
  jobId: string,
  overrides: Partial<StatusResponse>,
): StatusResponse => ({
  job_id: jobId,
  state: 'scanning',
  stage: 0,
  stage_name: 'Queued',
  progress: 0,
  complete: false,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: true,
  ...overrides,
})

/**
 * Resolve one authenticated status snapshot. The HTTP route and the SSE route
 * both call this same function, so event clients and one-shot reconciliation
 * cannot drift in ownership, wellness redaction, persistence, or error posture.
 */
export async function resolveStatus(
  request: Request,
  jobId: string,
  deps: StatusRouteDeps = {},
): Promise<StatusResolution> {
  const serverJob = await (deps.getJob ?? getJob)(jobId)

  if (!serverJob) {
    // Redis key expired — check Supabase for persisted analysis.
    const persisted = await (deps.getAnalysisByServerJobId ?? getAnalysisByServerJobId)(jobId)
    if (persisted) {
      const access = verifyJobAccess(request, null, persisted)
      if (!access.ok) return { ok: false, status: access.status, body: access.body }

      // Wellness signals stay behind the medical boundary (§5).
      const maySee = await resolveMedicalAccess(persisted.auth0_id, access.callerSub)
      return {
        ok: true,
        response: statusResponse(jobId, {
          state: persisted.complete ? 'completed' : 'failed',
          stage: persisted.stage ?? -1,
          stage_name: persisted.stage_name ?? (persisted.complete ? 'Complete' : 'Failed'),
          progress: persisted.progress ?? 0,
          complete: persisted.complete,
          summary: maySee ? persisted.summary_json : redactWellness(persisted.summary_json),
          video_ready: persisted.video_ready,
          error: persisted.error_message,
          error_code: persisted.error_code,
          retryable: false,
        }),
      }
    }

    // Not-found is terminal on every path: polling again cannot fix an
    // expired/unknown job, so JOB_NOT_FOUND always answers retryable: false.
    return {
      ok: false,
      status: 404,
      body: buildError('JOB_NOT_FOUND', 'Analysis session not found.', false),
    }
  }

  const access = verifyJobAccess(request, serverJob)
  if (!access.ok) return { ok: false, status: access.status, body: access.body }

  // Read engine job status via HTTP (engine computes stage_name and video_ready).
  const result = await getEngineJobStatus(serverJob.engine_job_id, requestIdFrom(request))

  // Engine connectivity loss is transient, but it is still a failed status
  // fetch. Return the canonical retryable 503 so bounded pollers/backoff do
  // not mistake a synthetic 200 "Retrying..." snapshot for fresh progress.
  if (result.status === 'transient_error') {
    return {
      ok: false,
      status: 503,
      body: buildError('ENGINE_UNAVAILABLE', 'Analysis engine is temporarily unavailable.', true),
    }
  }

  // Handle truly not found — the job expired or was never created.
  if (result.status === 'not_found') {
    await (deps.persistAnalysisStatus ?? persistAnalysisStatus)({
      serverJobId: serverJob.server_job_id,
      engineJobId: serverJob.engine_job_id,
      sessionToken: serverJob.session_token,
      playerIndex: serverJob.player_index,
      model: serverJob.model,
      status: buildFailedAnalysisStatus({
        error: 'Analysis job expired or was not found in the engine.',
        error_code: 'JOB_NOT_FOUND',
        retryable: false,
      }),
    })

    return {
      ok: true,
      response: statusResponse(serverJob.server_job_id, {
        state: 'failed',
        stage: -1,
        stage_name: 'Failed',
        complete: true,
        error: 'Analysis job expired or was not found in the engine.',
        error_code: 'JOB_NOT_FOUND',
        retryable: false,
      }),
    }
  }

  // Success case — engine returned status.
  const engineStatus = result.data
  const stageName = engineStatus.stage_name ?? engineStatus.state
  const videoReady = engineStatus.video_ready

  await (deps.persistAnalysisStatus ?? persistAnalysisStatus)({
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

  // Wellness signals stay behind the medical boundary (§5). The check runs
  // only when a summary exists; the persisted row names the owning account.
  let summary: unknown = engineStatus.summary
  if (summary) {
    const owner = await getAnalysisOwner(serverJob.server_job_id)
    const maySee = await resolveMedicalAccess(owner?.auth0_id ?? null, access.callerSub)
    if (!maySee) summary = redactWellness(summary)
  }

  return {
    ok: true,
    response: statusResponse(serverJob.server_job_id, {
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
    }),
  }
}

export const statusRoute = (deps: StatusRouteDeps = {}) =>
  new Elysia().get('/api/job-status/:jobId', async ({ params, request, set }) => {
    const result = await resolveStatus(request, params.jobId, deps)
    if (!result.ok) {
      set.status = result.status
      return result.body
    }
    set.status = 200
    return result.response
  })

export default statusRoute()
