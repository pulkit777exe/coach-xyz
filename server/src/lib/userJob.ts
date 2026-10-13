// ── User-library handler adapter ─────────────────────────────────────────────
// One home for the chain every guarded curatorial handler repeats:
// required-params check → authorizeJob → store fn → audit → error mapping.
// Handlers keep only their store call plus a declarative audit spec; reads
// stay explicit (their missing-param messages are API contract).

import { auditRoute } from './audit'
import type { Caller } from './caller'
import { buildError } from './errors'
import { authorizeJob, type JobGuardDeps } from './jobGuard'

export type UserJobAudit = {
  action: Parameters<typeof auditRoute>[2]
  entity: string
  id?: string | null
  meta?: Record<string, unknown> | null
}

export type UserJobResult = {
  status: number
  body: unknown
  audit?: UserJobAudit | null
}

export type UserJobDeps = Pick<JobGuardDeps, 'resolveCaller'>

export const withUserJob = async (
  request: Request,
  set: { status?: number | string },
  opts: {
    auth0Id: string | undefined
    resourceId: string | undefined
    /** Required too when the key is present (e.g. clips/:clipId under :jobId). */
    jobId?: string | undefined
    missingMessage?: string
    permission: string
  },
  fn: (caller: Caller) => Promise<UserJobResult>,
  deps?: UserJobDeps,
): Promise<unknown> => {
  const { auth0Id, resourceId, permission } = opts
  if (!auth0Id || !resourceId || ('jobId' in opts && !opts.jobId)) {
    set.status = 400
    return buildError(
      'INVALID_REQUEST',
      opts.missingMessage ?? 'Missing required parameters',
      false,
    )
  }
  const guard = await authorizeJob(auth0Id, request, permission, deps)
  if (!guard.ok) {
    set.status = guard.status
    return guard.error
  }
  const result = await fn(guard.caller)
  if (result.audit) {
    auditRoute(
      request,
      auth0Id,
      result.audit.action,
      result.audit.entity,
      result.audit.id,
      result.audit.meta,
    )
  }
  set.status = result.status
  return result.body
}
