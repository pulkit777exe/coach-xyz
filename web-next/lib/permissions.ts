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
  'team.create',
  'team.manage',
  'team.manage_members',
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'report.read',
  'report.create',
  'finding.review',
  'medical.read',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'team.manage',
  'team.manage_members',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'report.read',
  'report.create',
  'finding.review',
]

const ANALYST_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'report.read',
  'report.create',
  'finding.review',
]

// Assistant coaches run sessions and review findings but cannot reshape teams
// or manage the roster — head coaches (and the legacy `coach` alias) can.
const ASSISTANT_COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'report.read',
  'report.create',
  'finding.review',
]

/** Role → granted permissions. Exported for the pinning test only. */
export const ROLE_PERMISSIONS: Record<OrgMemberRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'medical.read'),
  head_coach: COACH_PERMISSIONS,
  assistant_coach: ASSISTANT_COACH_PERMISSIONS,
  coach: COACH_PERMISSIONS,
  analyst: ANALYST_PERMISSIONS,
  medical: ['team.read', 'player.read', 'report.read', 'medical.read'],
  player: ['analysis.read', 'report.read'],
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
 * `orgRoleGuard([...])` on the email route family in server/src/index.ts —
 * strictly narrower than report.create: analysts may draft reports but cannot
 * email them; assistant coaches may.
 */
export const REPORT_SEND_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
]

/**
 * Roles allowed to delete a team. Pinned from the owner/admin floor in
 * server/src/routes/teams.ts — coaches may rename assigned teams
 * (team.manage, team-scoped) but only owners/admins may delete.
 */
export const TEAM_DELETE_ROLES: readonly OrgMemberRole[] = ['owner', 'admin']

/**
 * Roles allowed to invite members (and add them directly). Pinned from the
 * `orgRoleGuard(['owner', 'admin'])` scopes in server/src/routes/members.ts.
 * Head coaches and coaches can open the Members page (MEMBERS_NAV_ROLES) but
 * only owners/admins may issue invitations.
 */
export const MEMBER_INVITE_ROLES: readonly OrgMemberRole[] = ['owner', 'admin']

/**
 * Roles allowed to read another account's `/api/auth/user/*` trees (dashboard
 * stats + analyses, which carry full summary_json). Pinned from
 * `AUTH_USER_ALLOWED_MEMBER_ROLES` in server/src/lib/serviceGuard.ts — medical
 * and players are excluded by design; the dashboard landing skips those two
 * fetches outside this floor instead of letting one 403 reject its
 * Promise.all and null every widget.
 */
export const AUTH_USER_ALLOWED_MEMBER_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
  'analyst',
]

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
