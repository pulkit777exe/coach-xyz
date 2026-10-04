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

/**
 * Whether the persisted row is needed as an owner backstop for a Redis job.
 *
 * Both `download.ts` and `status.ts` used to load the persisted row ONLY when the
 * Redis mapping was missing (`serverJob ? null : await getAnalysisByServerJobId()`),
 * and `status.ts` passed `serverJob` alone. That is fine while `owner_ids` is
 * written correctly, because `analyze.ts` always seeds it — `orgAuth0Id` falls back
 * to the verified sub, so `[orgAuth0Id, owner].filter(Boolean)` is never empty for
 * an authenticated kickoff.
 *
 * But it makes the safety of a user's VIDEO rest entirely on that one array being
 * non-empty at write time, with no second source. `owner_ids` is typed OPTIONAL on
 * `ServerJob` and `enqueueAnalysis` persists `job.owner_ids ?? []`, so any future
 * caller that omits it stores an empty set — and an empty set means
 * "anonymous, bearer-accessible" here, i.e. anyone holding the job id can stream
 * the video and read the status. There is no row to catch it, because the
 * persisted owner is exactly what was not consulted.
 *
 * So the backstop is consulted on the ONE case where it can change the answer: a
 * Redis job whose owner set is empty. That keeps the fast path free — the extra
 * query only runs where the job would otherwise be treated as anonymous — and
 * turns "the write path was correct" from a load-bearing assumption into something
 * the read path no longer depends on.
 */
export function needsPersistedOwnerBackstop(job: Pick<ServerJob, 'owner_ids'> | null): boolean {
  if (!job) return true
  return (job.owner_ids ?? []).every((id) => !id)
}
