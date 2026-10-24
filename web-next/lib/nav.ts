export type NavRole =
  | 'owner'
  | 'head_coach'
  | 'junior_coach'
  | 'player'

/** Roles that may open the Members page (invite + role management). */
export const MEMBERS_NAV_ROLES: readonly NavRole[] = ['owner', 'head_coach']
export const AUDIT_NAV_ROLES: readonly NavRole[] = ['owner']

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
