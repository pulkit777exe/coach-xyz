// User role vocabulary — mirror of server/src/lib/userRoles.ts. The values AND
// order are contractual (see the userRoles *Contract tests on both sides).
export const USER_ROLES = ["coach", "player"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  coach: "Coach",
  player: "Player",
}