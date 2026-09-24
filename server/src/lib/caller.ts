import { SERVICE_HEADERS } from './serviceGuard'
import { buildError, type CoachAIError } from './errors'
import { getMemberRole, type OrgMemberRole } from './orgMembers'
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
  const role: OrgMemberRole | null =
    !verified || !orgAuth0Id
      ? null
      : verified === orgAuth0Id
        ? 'owner'
        : await getMemberRole(orgAuth0Id, verified).catch(() => null)
  // Owners/admins bypass every scope check, so skip the membership lookup
  // for them (also keeps the owner fast-path DB-free).
  const teamIds =
    verified && role !== null && role !== 'owner' && role !== 'admin'
      ? await listMemberTeamIds(verified).catch(() => [])
      : []
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
