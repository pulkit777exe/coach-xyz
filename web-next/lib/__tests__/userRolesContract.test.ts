import { describe, expect, test } from "vitest"
import { USER_ROLES, USER_ROLE_LABELS } from "../userRoles"

// Canonical user-role vocabulary — values AND order must match
// server/src/lib/userRoles.ts (pinned there by
// server/tests/userRolesContract.test.ts). Single-sided edits break this test
// on the unchanged side, surfacing drift in CI.
const CANONICAL = {
  userRoles: ["coach", "player"],
} as const

describe("role vocabulary contract", () => {
  test("web values and order match the canonical list", () => {
    expect([...USER_ROLES]).toEqual(CANONICAL.userRoles)
  })

  test("web exports exactly the canonical roles", () => {
    expect(new Set(USER_ROLES)).toEqual(new Set(CANONICAL.userRoles))
  })

  test("every role has a label", () => {
    for (const role of USER_ROLES) {
      expect(typeof USER_ROLE_LABELS[role]).toBe("string")
    }
  })
})