// ── Job-status orchestration ─────────────────────────────────────────────────
// One home for the GET /api/job-status decision tree: Redis row → persisted
// fallback → engine poll → persist → medical-redacted response. Injectable
// seams ({ store, engine, access, medical }) in the admission style so tests
// drive every branch with fakes; the route maps outcomes to HTTP.

import { buildError } from './errors'
import { getJob } from './jobs'
import { verifyJobAccess } from './jobAccess'
import { getEngineJobStatus, requestIdFrom } from './engine'
import { redactWellness, resolveMedicalAccess } from './permissions'
import { persistAnalysisStatus, getAnalysisByServerJobId, getAnalysisOwner } from './analyses'

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

const statusResponse = (jobId: string, overrides: Partial<StatusResponse>): StatusResponse => ({
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

/** Injectable seams for tests (fake store/engine/access/medical, no live infra). */
export type StatusSeams = {
  getJob?: typeof getJob
  getPersisted?: typeof getAnalysisByServerJobId
  checkAccess?: typeof verifyJobAccess
  pollEngine?: typeof getEngineJobStatus
  persist?: typeof persistAnalysisStatus
  ownerOf?: typeof getAnalysisOwner
  medical?: typeof resolveMedicalAccess
  redact?: typeof redactWellness
  requestId?: typeof requestIdFrom
}

export type StatusOutcome =
  { ok: true; status: 200; body: StatusResponse } | { ok: false; status: number; body: unknown }

export const resolveJobStatus = async (
  serverJobId: string,
  request: Request,
  seams: StatusSeams = {},
): Promise<StatusOutcome> => {
  const getJobFn = seams.getJob ?? getJob
  const getPersisted = seams.getPersisted ?? getAnalysisByServerJobId
  const checkAccess = seams.checkAccess ?? verifyJobAccess
  const pollEngine = seams.pollEngine ?? getEngineJobStatus
  const persist = seams.persist ?? persistAnalysisStatus
  const ownerOf = seams.ownerOf ?? getAnalysisOwner
  const medical = seams.medical ?? resolveMedicalAccess
  const redact = seams.redact ?? redactWellness
  const requestId = seams.requestId ?? requestIdFrom

  const serverJob = await getJobFn(serverJobId)

  if (!serverJob) {
    // Redis key expired — check Supabase for persisted analysis
    const persisted = await getPersisted(serverJobId)
    if (persisted) {
      const access = checkAccess(request, null, persisted)
      if (!access.ok) return { ok: false, status: access.status, body: access.body }
      // Wellness signals stay behind the medical boundary (§5).
      const maySee = await medical(persisted.auth0_id, access.callerSub)
      return {
        ok: true,
        status: 200,
        body: statusResponse(serverJobId, {
          state: persisted.complete ? 'completed' : 'failed',
          stage: persisted.stage ?? -1,
          stage_name: persisted.stage_name ?? (persisted.complete ? 'Complete' : 'Failed'),
          progress: persisted.progress ?? 0,
          complete: persisted.complete,
          summary: maySee ? persisted.summary_json : redact(persisted.summary_json),
          video_ready: persisted.video_ready,
          error: persisted.error_message,
          error_code: persisted.error_code,
          retryable: false,
        }),
      }
    }

    return {
      ok: false,
      status: 404,
      body: buildError('JOB_NOT_FOUND', 'Analysis session not found.', false),
    }
  }

  const access = checkAccess(request, serverJob)
  if (!access.ok) return { ok: false, status: access.status, body: access.body }

  // Read engine job status via HTTP (engine computes stage_name and video_ready)
  const result = await pollEngine(serverJob.engine_job_id, requestId(request))

  // Handle transient engine connectivity errors — don't permanently fail the job
  if (result.status === 'transient_error') {
    // Return last known state or a "retrying" state, don't persist as failed
    return {
      ok: true,
      status: 200,
      body: statusResponse(serverJob.server_job_id, {
        state: 'scanning', // Assume still processing
        stage: 1,
        stage_name: 'Retrying...',
      }),
    }
  }

  // Handle truly not found — the job expired or was never created
  if (result.status === 'not_found') {
    // Persist the failed status before returning so it shows in history
    await persist({
      serverJobId: serverJob.server_job_id,
      engineJobId: serverJob.engine_job_id,
      sessionToken: serverJob.session_token,
      playerIndex: serverJob.player_index,
      model: serverJob.model,
      status: {
        stage: -1,
        stage_name: 'Failed',
        progress: 0,
        complete: true,
        video_ready: false,
        summary: null,
        error: 'Analysis job expired or was not found in the engine.',
        error_code: 'JOB_NOT_FOUND',
        retryable: true,
      },
    })

    return {
      ok: true,
      status: 200,
      body: statusResponse(serverJob.server_job_id, {
        state: 'failed',
        stage: -1,
        stage_name: 'Failed',
        complete: true,
        error: 'Analysis job expired or was not found in the engine.',
        error_code: 'JOB_NOT_FOUND',
      }),
    }
  }

  // Success case — engine returned status
  const engineStatus = result.data

  // Engine returns stage_name and video_ready as computed fields
  const stageName = engineStatus.stage_name ?? engineStatus.state
  const videoReady = engineStatus.video_ready

  await persist({
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
    const owner = await ownerOf(serverJob.server_job_id)
    const maySee = await medical(owner?.auth0_id ?? null, access.callerSub)
    if (!maySee) summary = redact(summary)
  }
  return {
    ok: true,
    status: 200,
    body: statusResponse(serverJob.server_job_id, {
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
