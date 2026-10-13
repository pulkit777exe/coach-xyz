// ── Player scope adapter ─────────────────────────────────────────────────────
// One home for the chain every self-scoped /api/me route repeats:
// verified-identity guard → linked-player scope → uniform linked handling.
// Routes keep their store calls; this owns guard + scope + the pure analyze
// decision. Same adapter shape as withUserJob / the capability kernel.

import { buildError, type CoachAIError } from './errors'
import { getLinkedPlayer } from './orgRoster'
import { SERVICE_HEADERS } from './serviceGuard'
import { resolveAuth0Id } from './users'

export type PlayerScope = {
  accountAuth0Id: string
  student: { id: string } | null
  coachAuth0Id: string | null
}

/** Verified caller sub from the proxy-injected header (null when absent). */
export const readVerifiedIdentity = (request: Request): string | null =>
  request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)

export const missingIdentity = () => buildError('FORBIDDEN', 'Missing verified identity', false)

/** Injectable seams for tests (fake identity/store, no live infra). */
export type PlayerScopeDeps = {
  resolveAuth0Id?: typeof resolveAuth0Id
  getLinkedPlayer?: typeof getLinkedPlayer
}

/**
 * Resolves the verified caller to their linked player view: the owning
 * coach's auth0Id plus the student row. Nulls when the account is not
 * linked to any student yet (linked accounts resolve via the primary sub).
 */
export const resolvePlayerScope = async (
  verifiedAuth0Id: string,
  deps?: PlayerScopeDeps,
): Promise<PlayerScope> => {
  const primary =
    (await (deps?.resolveAuth0Id ?? resolveAuth0Id)(verifiedAuth0Id)) ?? verifiedAuth0Id
  const linked = await (deps?.getLinkedPlayer ?? getLinkedPlayer)(primary)
  return {
    accountAuth0Id: primary,
    student: linked?.student ?? null,
    coachAuth0Id: linked?.coachAuth0Id ?? null,
  }
}

export const withVerified = async (
  request: Request,
  set: { status?: number | string },
  fn: (verified: string) => Promise<unknown>,
): Promise<unknown> => {
  const verified = readVerifiedIdentity(request)
  if (!verified) {
    set.status = 403
    return missingIdentity()
  }
  return fn(verified)
}

export type LinkedScope = {
  accountAuth0Id: string
  student: { id: string }
  coachAuth0Id: string
}

/**
 * Guard + scope with the unlinked early-out. Unlinked callers get `unlinked`
 * (each route's own empty shape) with a 200; linked callers run `fn` with a
 * fully-resolved scope — no null checks past this point.
 */
export const withPlayerScope = async <T>(
  request: Request,
  set: { status?: number | string },
  unlinked: T,
  fn: (scope: LinkedScope) => Promise<T | unknown>,
  deps?: PlayerScopeDeps,
): Promise<unknown> => {
  return withVerified(request, set, async (verified) => {
    const scope = await resolvePlayerScope(verified, deps)
    if (!scope.student || !scope.coachAuth0Id) {
      set.status = 200
      return unlinked
    }
    return fn({
      accountAuth0Id: scope.accountAuth0Id,
      student: scope.student,
      coachAuth0Id: scope.coachAuth0Id,
    })
  })
}

/**
 * Pure "me-analyze" scoping decision. Turns the verified player identity +
 * their resolved player scope into the coach-scoped persistence target (the
 * job shows up in the coach's history) plus the attribution (requested_by).
 * Returns an error descriptor when the account is not linked/verified.
 */
export type PlayerAnalysisDecision =
  | { ok: true; coachAuth0Id: string; requestedBy: string; studentId: string }
  | { ok: false; status: 403; error: CoachAIError }

export const decidePlayerAnalysis = (input: {
  verifiedAuth0Id: string | null
  playerScope: PlayerScope
}): PlayerAnalysisDecision => {
  const { verifiedAuth0Id, playerScope: scope } = input
  if (!verifiedAuth0Id) {
    return {
      ok: false,
      status: 403,
      error: buildError('FORBIDDEN', 'Missing verified identity', false),
    }
  }
  if (!scope.student || !scope.coachAuth0Id) {
    return {
      ok: false,
      status: 403,
      error: buildError('FORBIDDEN', 'No linked player account', false),
    }
  }
  return {
    ok: true,
    coachAuth0Id: scope.coachAuth0Id,
    requestedBy: verifiedAuth0Id,
    studentId: scope.student.id,
  }
}
