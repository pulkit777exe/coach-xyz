export type NavRole =
  | 'owner'
  | 'admin'
  | 'head_coach'
  | 'assistant_coach'
  | 'coach'
  | 'analyst'
  | 'medical'
  | 'player'

/** Roles that may open the Members page (invite + role management). */
export const MEMBERS_NAV_ROLES: readonly NavRole[] = ['owner', 'admin', 'head_coach', 'coach']

/** Roles that may open the Audit Log page. */
export const AUDIT_NAV_ROLES: readonly NavRole[] = ['owner', 'admin']

/** Every org-role vocabulary value — used to derive the non-player set. */
const ALL_NAV_ROLES: readonly NavRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
  'analyst',
  'medical',
  'player',
]

/**
 * Roles that may open the org roster, planning, and history pages. Players are
 * self-service only (Home, New Analysis, Account, Settings) — the server
 * blocks org players from every /api/org/* route, so those links would 403.
 */
export const ALL_NON_PLAYER_ROLES: readonly NavRole[] = ALL_NAV_ROLES.filter(
  (navRole) => navRole !== 'player',
)

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
