import { SERVICE_HEADERS } from './serviceGuard'
import { getMemberAccess, type OrgMemberRole } from './orgMembers'
import { listMemberTeamIds, listPlayerTeamIds } from './teams'
import {
  canAccessTeam,
  canSeeTeam,
  decide,
  hasPermission,
  parseGrants,
  resolveStudentScope,
  type AccessDecision,
  type Grant,
  type Permission,
} from './permissions'

// ── Caller resolution ────────────────────────────────────────────────────────
// One interface for "who is calling this org route": identity, org, role,
// team scope, and grants. Route handlers resolve once and ask the access
// resolver (can / decide / canAccessTeam) instead of checking roles.

export type Caller = {
  /** Verified session sub, or null when the identity boundary gave none. */
  verified: string | null
  /** Org this caller was resolved against. */
  orgId: string
  /** Org role (owner fast-path included); null for non-members. */
  role: OrgMemberRole | null
  /** Owner-granted permission flags. */
  grants: Grant[]
  /** Team ids the caller belongs to (coach-side link). */
  teamIds: string[]
  /** Roster visibility derived from role + teams. */
  studentScope: { all: true } | { all: false; teamIds: string[] }
  /** Permission check against the caller's role and grants. */
  can: (permission: Permission) => boolean
  /** Combined decision (permission + org + optional team/self). */
  decide: (
    permission: Permission,
    resource?: { teamId?: string | null; ownerId?: string | null; inviteRole?: OrgMemberRole | null },
  ) => AccessDecision
  /** Team-scope check (owners bypass). */
  canAccessTeam: (teamId: string) => boolean
  canSeeTeam: (teamId: string) => boolean
}

export async function resolveCaller(orgAuth0Id: string, request: Request): Promise<Caller> {
  const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
  const access =
    !verified || !orgAuth0Id
      ? null
      : verified === orgAuth0Id
        ? { role: 'owner' as const, grants: [] as string[] }
        : await getMemberAccess(orgAuth0Id, verified).catch(() => null)
  const role = access?.role ?? null
  const grants = parseGrants(access?.grants)
  const teamIds =
    verified && role !== null && role !== 'owner'
      ? role === 'player'
        ? await listPlayerTeamIds(verified).catch(() => [])
        : await listMemberTeamIds(verified).catch(() => [])
      : []
  return {
    verified,
    orgId: orgAuth0Id,
    role,
    grants,
    teamIds,
    studentScope: resolveStudentScope(role, teamIds),
    can: (permission) => hasPermission(role, permission, grants),
    decide: (permission, resource = {}) =>
      decide(
        {
          actorId: verified ?? '',
          orgId: orgAuth0Id,
          role,
          teamIds,
          grants,
        },
        permission,
        { orgId: orgAuth0Id, ...resource },
      ),
    canAccessTeam: (teamId) => canAccessTeam(role, teamIds, teamId),
    canSeeTeam: (teamId) => canSeeTeam(role, teamIds, teamId),
  }
}
