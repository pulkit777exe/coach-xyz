import { ORG_MEMBER_ROLES, type OrgMemberRole } from './members'

// Nav visibility roles — an alias of the single membership vocabulary
// (ORG_MEMBER_ROLES in lib/members.ts), not a second list to keep in sync.
// A server-side role addition flows here automatically; nav.test.ts pins the
// page-gating subsets below, not the vocabulary itself.
export type NavRole = OrgMemberRole

/** Roles that may open the Members page (invite + role management). */
export const MEMBERS_NAV_ROLES: readonly NavRole[] = ['owner', 'head_coach']

/** Roles that may open the Audit Log page. */
export const AUDIT_NAV_ROLES: readonly NavRole[] = ['owner']

/** Every org-role vocabulary value — sourced from the canonical membership set. */
const ALL_NAV_ROLES: readonly NavRole[] = ORG_MEMBER_ROLES

/**
 * Roles that may open the org roster, planning, and history pages. Players are
 * self-service only (Home, New Analysis, Account, Settings) — the server
 * blocks org players from every /api/org/* route, so those links would 403.
 */
export const ALL_NON_PLAYER_ROLES: readonly NavRole[] = ALL_NAV_ROLES.filter(
  (navRole) => navRole !== 'player',
)

/**
 * Roles that may open the analysis History page: every staff role
 * (owner / head_coach / junior_coach all hold `analysis.read` in the permission
 * matrix in lib/permissions.ts). Players browse their own hub instead — the
 * server scopes every /api/org/* history read away from them.
 */
export const HISTORY_NAV_ROLES: readonly NavRole[] = ALL_NAV_ROLES.filter(
  (navRole) => navRole !== 'player',
)

/**
 * Roles offered the "New Analysis" link (sidebar + ⌘K palette): every role
 * holding `analysis.create` — staff through the org routes, players through
 * their self-service upload flow, which starts at Home. Every value in the
 * four-role vocabulary qualifies, so this is the full set, kept as a named
 * export so the nav's intent stays readable at the call sites.
 */
export const ANALYZE_NAV_ROLES: readonly NavRole[] = ALL_NAV_ROLES

export type GatedNavItem = {
  roles?: readonly NavRole[]
}

export type GatedNavGroup<T extends GatedNavItem> = {
  label: string | null
  items: T[]
}

/**
 * Pure role filter for dashboard navigation: drops items the role may not
 * see, then drops groups left empty. A null role (unresolved context) sees
 * everything — gating never locks out the single-coach fallback.
 */
export function visibleNavGroups<T extends GatedNavItem>(
  groups: GatedNavGroup<T>[],
  role: NavRole | null,
): GatedNavGroup<T>[] {
  if (!role) return groups
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0)
}
