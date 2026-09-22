import { timingSafeEqual } from 'node:crypto'

import { buildError } from './errors'
import { verifyAttributionToken } from './attribution'
import { SERVICE_HEADERS, serviceGuardEnabled } from './serviceGuard'
import type { ServerJob } from './jobs'

export type JobAccessCheck =
  | { ok: true; callerSub: string | null }
  | { ok: false; status: 403 | 404; body: ReturnType<typeof buildError> }

export type PersistedJobOwner = {
  auth0_id: string | null
  requested_by: string | null
} | null

/**
 * Resolve the caller of a browser-direct capability route. Accepts either a
 * signed `x-attribution` token (browser flows, minted per session sub), the
 * same token as an `?attribution=` query param (headerless consumers such as
 * <video src> / <a href> on the download route — verified identically), or
 * the service identity headers (server-to-server / proxied calls). Returns
 * null when the request carries no verifiable identity — anonymous jobs stay
 * readable by bearer id, owned jobs do not.
 */
export function resolveJobCaller(request: Request): string | null {
  const viaHeader = verifyAttributionToken(request.headers.get('x-attribution'))
  if (viaHeader) return viaHeader
  try {
    const viaQuery = verifyAttributionToken(new URL(request.url).searchParams.get('attribution'))
    if (viaQuery) return viaQuery
  } catch {
    // Non-absolute URL — ignore the query fallback.
  }
  if (!serviceGuardEnabled()) return null
  const token = request.headers.get(SERVICE_HEADERS.token)
  const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
  const expected = process.env.SERVICE_TOKEN
  if (token && expected && verified) {
    try {
      if (timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return verified
    } catch {
      // Length mismatch — not a match.
    }
  }
  return null
}

/**
 * Authorize a read/chat/download against a job's owner set. Jobs with an
 * empty owner set are anonymous (demo flow) and stay bearer-accessible. Jobs
 * with owners require the caller's verified sub to be one of the owners.
 * The persisted row (auth0_id + requested_by) is a fallback owner source for
 * jobs whose Redis mapping expired.
 */
export function verifyJobAccess(
  request: Request,
  job: Pick<ServerJob, 'owner_ids'> | null,
  persisted: PersistedJobOwner = null,
): JobAccessCheck {
  const owners = new Set<string>()
  for (const id of job?.owner_ids ?? []) if (id) owners.add(id)
  if (persisted?.auth0_id) owners.add(persisted.auth0_id)
  if (persisted?.requested_by) owners.add(persisted.requested_by)

  if (owners.size === 0) return { ok: true, callerSub: null }

  const caller = resolveJobCaller(request)
  if (caller && owners.has(caller)) return { ok: true, callerSub: caller }
  return {
    ok: false,
    status: 403,
    body: buildError('FORBIDDEN', 'This analysis belongs to another account.', false),
  }
}
