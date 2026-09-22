import type { OrgMemberRole } from "./orgMembers"

// ── Permission vocabulary (§4) ───────────────────────────────────────────────
// Roles grant membership; permissions grant actions; team scope narrows WHERE.
// `hasPermission` is the pure decision point — route guards resolve the
// caller's org role, then check the required permission here instead of
// re-literalizing role lists per route.

export const PERMISSIONS = [
  "org.invite",
  "org.manage_members",
  "team.create",
  "team.manage",
  "team.manage_members",
  "team.read",
  "analysis.create",
  "analysis.read",
  "player.read",
  "player.manage",
  "report.read",
  "report.create",
  "finding.review",
  "medical.read",
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const COACH_PERMISSIONS: readonly Permission[] = [
  "team.read",
  "team.manage",
  "team.manage_members",
  "analysis.create",
  "analysis.read",
  "player.read",
  "player.manage",
  "report.read",
  "report.create",
  "finding.review",
]

const ANALYST_PERMISSIONS: readonly Permission[] = [
  "team.read",
  "analysis.create",
  "analysis.read",
  "player.read",
  "report.read",
  "report.create",
  "finding.review",
]

const ROLE_PERMISSIONS: Record<OrgMemberRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "medical.read"),
  coach: COACH_PERMISSIONS,
  analyst: ANALYST_PERMISSIONS,
  medical: ["team.read", "player.read", "report.read", "medical.read"],
  player: ["analysis.read", "report.read"],
}

/** Pure permission check: does this org role grant the permission? */
export function hasPermission(role: OrgMemberRole | null, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Pure team-scope check: is the caller allowed to act on this team?
 * Owners/admins bypass scope; coaches/analysts/medical must hold a team
 * membership; players never act on teams (self-scope only).
 */
export function canAccessTeam(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
  teamId: string,
): boolean {
  if (role === "owner" || role === "admin") return true
  if (role === "coach" || role === "analyst" || role === "medical") {
    return memberTeamIds.includes(teamId)
  }
  return false
}
