import { SERVICE_HEADERS } from './serviceGuard'
import { buildError, type CoachAIError } from './errors'
import { getMemberRole, type OrgMemberRole } from './orgMembers'
import { logger } from './logger'
import { listMemberTeamIds } from './teams'
import { canAccessTeam, hasPermission, resolveStudentScope, type Permission } from './permissions'

// ── Caller resolution ────────────────────────────────────────────────────────
// One interface for "who is calling this org route": identity, org role,
// team memberships, and the derived student scope. Route handlers resolve
// once and ask questions (can / canAccessTeam / studentScope) instead of
// re-literalizing the owner fast-path + membership lookup per handler.

export type Caller = {
  /** Verified session sub, or null when the identity boundary gave none. */
  verified: string | null
  /** Org role (owner fast-path included); null for non-members. */
  role: OrgMemberRole | null
  /** Team ids the caller belongs to (coach-side link). */
  teamIds: string[]
  /** Roster visibility derived from role + teams. */
  studentScope: { all: true } | { all: false; teamIds: string[] }
  /** Permission check against the caller's role. */
  can: (permission: Permission) => boolean
  /** Team-scope check (owners/admins bypass). */
  canAccessTeam: (teamId: string) => boolean
}

export async function resolveCaller(orgAuth0Id: string, request: Request): Promise<Caller> {
  const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
  // A lookup throw means the DB errored (getMemberRole returns null for
  // non-members without throwing) — fail closed to null, but log it: an
  // invisible outage here silently denies every non-owner caller.
  let role: OrgMemberRole | null = null
  if (verified && orgAuth0Id && verified !== orgAuth0Id) {
    try {
      role = await getMemberRole(orgAuth0Id, verified)
    } catch (error) {
      logger.warn('member_role_lookup_failed', {
        type: 'member_role_lookup_failed',
        orgAuth0Id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (verified && orgAuth0Id) {
    role = 'owner'
  }
  // Owners/admins bypass every scope check, so skip the membership lookup
  // for them (also keeps the owner fast-path DB-free).
  let teamIds: string[] = []
  if (verified && role !== null && role !== 'owner' && role !== 'admin') {
    try {
      teamIds = await listMemberTeamIds(verified)
    } catch (error) {
      logger.warn('member_team_lookup_failed', {
        type: 'member_team_lookup_failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return {
    verified,
    role,
    teamIds,
    studentScope: resolveStudentScope(role, teamIds),
    can: (permission) => hasPermission(role, permission),
    canAccessTeam: (teamId) => canAccessTeam(role, teamIds, teamId),
  }
}

// ── Self-scope identity ─────────────────────────────────────────────────────
// Self routes (/api/me/*) carry no auth0Id in path or body: the proxy-injected
// verified header IS the resource owner, so a present verified id suffices.
// When SERVICE_TOKEN is unset, serviceGuard is inert by design — this
// handler-level check is then the ONLY enforcement of the identity boundary,
// so its predicate must match verifyServiceIdentity's byte-for-byte: header
// missing OR empty (falsy — not just null) → 403 Missing verified identity.

export type MissingVerifiedSelf = {
  ok: false
  status: 403
  error: CoachAIError
}

/**
 * The canonical missing-identity rejection (403, non-retryable FORBIDDEN).
 * Single owner of the literal message; pure decisions such as
 * `decidePlayerAnalysis` return it without a request context.
 */
export function missingVerifiedSelf(): MissingVerifiedSelf {
  return {
    ok: false,
    status: 403,
    error: buildError('FORBIDDEN', 'Missing verified identity', false),
  }
}

type SelfScopeContext = {
  request: Request
  set: { status?: number | string }
}

/**
 * Resolve the verified caller for a self-scoped handler, or reject it.
 * Returns the verified auth0Id; when the header is missing/empty, sets
 * `set.status = 403` and returns the canonical error body:
 *
 *   const verified = requireVerifiedSelf({ request, set })
 *   if (typeof verified !== 'string') return verified
 */
export function requireVerifiedSelf({ request, set }: SelfScopeContext): string | CoachAIError {
  const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
  if (!verified) {
    const rejection = missingVerifiedSelf()
    set.status = rejection.status
    return rejection.error
  }
  return verified
}
