import { SERVICE_HEADERS } from "./serviceGuard"
import { getMemberRole, type OrgMemberRole } from "./orgMembers"
import { listMemberTeamIds } from "./teams"
import {
  canAccessTeam,
  hasPermission,
  resolveStudentScope,
  type Permission,
} from "./permissions"

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
        ? "owner"
        : await getMemberRole(orgAuth0Id, verified).catch(() => null)
  // Owners/admins bypass every scope check, so skip the membership lookup
  // for them (also keeps the owner fast-path DB-free).
  const teamIds =
    verified && role !== null && role !== "owner" && role !== "admin"
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
