import { describe, expect, test } from 'bun:test'
import { USER_ROLES } from '../src/lib/userRoles'

// Canonical user-role vocabulary — values AND order must match
// web-next/lib/userRoles.ts (pinned there by
// web-next/lib/__tests__/userRolesContract.test.ts). Single-sided edits break
// this test on the unchanged side, surfacing drift in CI.
const CANONICAL = {
  userRoles: ['coach', 'player'],
} as const

describe('role vocabulary contract', () => {
  test('server values and order match the canonical list', () => {
    expect([...USER_ROLES]).toEqual([...CANONICAL.userRoles])
  })

  test('server exports exactly the canonical roles', () => {
    expect(new Set(USER_ROLES)).toEqual(new Set(CANONICAL.userRoles))
  })
})
