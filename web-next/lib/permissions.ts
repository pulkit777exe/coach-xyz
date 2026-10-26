import type { OrgMemberRole } from './members'

// ── Permission vocabulary ───────────────────────────────────────────────────
// Mirrors server/src/lib/permissions.ts — same vocabulary and role→permission
// matrix, pinned on this side by lib/__tests__/permissions.test.ts so a
// single-sided edit breaks CI (same contract pattern as ORG_MEMBER_ROLES).
// Roles grant membership; permissions grant actions; this module is the pure
// decision point for UI gating: hide or disable what the server would reject,
// never as a security boundary (the server enforces; we surface).

export const PERMISSIONS = [
  'org.invite',
  'org.manage_members',
  'org.audit',
  'org.settings',
  'org.billing',
  'org.export',
  'team.create',
  'team.delete',
  'team.manage',
  'team.manage_members',
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'report.read',
  'report.create',
  'report.publish',
  'report.delete',
  'report.export',
  'finding.review',
  'medical.read',
  'attendance.mark',
  'attendance.write',
  'schedule.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const HEAD_COACH_PERMISSIONS: readonly Permission[] = [
  'org.invite',
  'team.manage',
  'team.manage_members',
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'report.read',
  'report.create',
  'report.publish',
  'report.delete',
  'finding.review',
  'attendance.mark',
  'attendance.write',
  'schedule.manage',
]

const JUNIOR_COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'report.read',
  'report.create',
  'attendance.mark',
  'attendance.write',
]

const PLAYER_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.read',
  'report.read',
]

/** Role → granted permissions. Exported for the pinning test only. */
export const ROLE_PERMISSIONS: Record<OrgMemberRole, readonly Permission[]> = {
  owner: ALL,
  head_coach: HEAD_COACH_PERMISSIONS,
  junior_coach: JUNIOR_COACH_PERMISSIONS,
  player: PLAYER_PERMISSIONS,
}

/** Pure permission check: does this org role grant the permission? */
export function hasPermission(
  role: OrgMemberRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

// ── Route floors pinned from the server ─────────────────────────────────────
// These are literal role lists the server mounts as guards. The UI mirrors
// them so a button never appears for a role the route would 403 — the web
// cannot mint these lists itself (the email floor is narrower than the
// report.create matrix, for example), so both sides are pinned by test.

/**
 * Roles allowed to email a report. Pinned from the app-level
 * `orgRoleGuard([...])` on the email route family in server/src/index.ts.
 */
export const REPORT_SEND_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'head_coach',
  'junior_coach',
]

/**
 * Roles allowed to delete a team. Pinned from the owner floor in
 * server/src/routes/teams.ts.
 */
export const TEAM_DELETE_ROLES: readonly OrgMemberRole[] = ['owner']

/**
 * Roles allowed to invite members (and add them directly). Pinned from the
 * `orgRoleGuard(['owner', 'head_coach'])` scopes in server/src/routes/members.ts.
 */
export const MEMBER_INVITE_ROLES: readonly OrgMemberRole[] = ['owner', 'head_coach']

/**
 * Roles allowed to read another account's `/api/auth/user/*` trees (dashboard
 * stats + analyses, which carry full summary_json). Pinned from
 * `AUTH_USER_ALLOWED_MEMBER_ROLES` in server/src/lib/serviceGuard.ts —
 * players are excluded by design; the dashboard landing skips those two
 * fetches outside this floor instead of letting one 403 reject its
 * Promise.all and null every widget.
 */
export const AUTH_USER_ALLOWED_MEMBER_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'head_coach',
  'junior_coach',
]

export type AnalysisDetailCapabilities = {
  canShareTokens: boolean
  canLinkToStudent: boolean
}

/**
 * UI capability decision for the org-owned analysis detail action bar. Sharing
 * reuses the report/share floor; linking an analysis to a student is roster
 * management. Deletion is intentionally absent because its server decision is
 * resource-ownership/identity-based rather than a role-management capability.
 */
export function analysisDetailCapabilities(
  role: OrgMemberRole | null | undefined,
): AnalysisDetailCapabilities {
  return {
    canShareTokens: role != null && REPORT_SEND_ROLES.includes(role),
    canLinkToStudent: hasPermission(role, 'player.manage'),
  }
}

// ── Dashboard quick actions ─────────────────────────────────────────────────
// The landing-page action tiles (New analysis / Add student / Schedule event
// / Invite member). Derived, never hand-listed: a tile must not appear when
// the destination page would render read-only or denied for that role — tile
// and destination share this one decision point.

export type DashboardQuickActions = {
  /** New analysis → needs the full loop: create results and read them back. */
  analyze: boolean
  /** Add student → same floor as the Students page's manage affordances. */
  manageStudents: boolean
  /** Schedule event → staff surface (no server floor yet — CODEBASE_MAP gaps). */
  schedule: boolean
  /** Invite member → members-route invite floor. */
  invite: boolean
}

export function dashboardQuickActions(
  role: OrgMemberRole | null | undefined,
): DashboardQuickActions {
  return {
    analyze: hasPermission(role, 'analysis.create') && hasPermission(role, 'analysis.read'),
    manageStudents: hasPermission(role, 'player.manage'),
    schedule: role != null && role !== 'player',
    invite: role != null && MEMBER_INVITE_ROLES.includes(role),
  }
}
