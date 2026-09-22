// User role vocabulary — single source of truth for the server. Mirrored on the
// web (web-next/lib/userRoles.ts) with values AND order pinned contractually by
// the userRoles *Contract tests on both sides. Add a value here and there.
export const USER_ROLES = ['coach', 'player'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  coach: 'Coach',
  player: 'Player',
}
