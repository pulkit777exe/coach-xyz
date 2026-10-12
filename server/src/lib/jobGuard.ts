// ── Job guard (Pundit-style single-purpose policy) ───────────────────────────
// One home for the two checks every job-scoped auth handler repeats:
// ownership + finding.review authorization, and the best-effort engine
// failure mark that cancel/delete share. Route handlers resolve the guard
// once and map the verdict to their status code instead of re-literalizing
// the owner fast-path or the getJob + markEngineJobFailed pair per handler.

import { resolveCaller, type Caller } from './caller'
import { markEngineJobFailed } from './engine'
import { getJob } from './jobs'
import { buildError, type CoachAIError } from './errors'

export type AuthorizeJobResult =
  { ok: true; caller: Caller } | { ok: false; status: 403; error: CoachAIError }

/** Injectable seams for tests (fake store/engine, no live infra). */
export type JobGuardDeps = {
  resolveCaller?: typeof resolveCaller
  getJob?: typeof getJob
  markEngineJobFailed?: typeof markEngineJobFailed
}

/**
 * Ownership + finding.review gate. The owning account self-passes; other
 * members need the finding.review permission. Returns the resolved caller
 * so handlers keep using `caller.verified` for attribution/rate limits.
 */
export const authorizeJob = async (
  auth0Id: string,
  request: Request,
  deniedMessage: string,
  deps?: Pick<JobGuardDeps, 'resolveCaller'>,
): Promise<AuthorizeJobResult> => {
  const caller = await (deps?.resolveCaller ?? resolveCaller)(auth0Id, request)
  if (!caller.verified) {
    return {
      ok: false,
      status: 403,
      error: buildError('FORBIDDEN', 'Missing verified identity', false),
    }
  }
  if (caller.verified !== auth0Id && !caller.can('finding.review')) {
    return { ok: false, status: 403, error: buildError('FORBIDDEN', deniedMessage, false) }
  }
  return { ok: true, caller }
}

/**
 * Shared failed-mark for cancel/delete: look up the server job and fail its
 * engine counterpart as ANALYSIS_CANCELLED so status polling never completes
 * it. No-op when the server job is already gone.
 */
export const failEngineJobForServerJob = async (
  serverJobId: string,
  message: string,
  deps?: Pick<JobGuardDeps, 'getJob' | 'markEngineJobFailed'>,
): Promise<void> => {
  const serverJob = await (deps?.getJob ?? getJob)(serverJobId)
  if (!serverJob) return
  await (deps?.markEngineJobFailed ?? markEngineJobFailed)(
    serverJob.engine_job_id,
    message,
    'ANALYSIS_CANCELLED',
    false,
    serverJobId,
  )
}
