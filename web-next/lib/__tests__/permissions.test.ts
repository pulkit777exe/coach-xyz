import { describe, expect, test } from 'vitest'
import { ORG_MEMBER_ROLES, type OrgMemberRole } from '@/lib/members'
import {
  MEMBER_INVITE_ROLES,
  PERMISSIONS,
  REPORT_SEND_ROLES,
  ROLE_PERMISSIONS,
  TEAM_DELETE_ROLES,
  hasPermission,
  type Permission,
} from '@/lib/permissions'

// ── Contract: web matrix mirrors server/src/lib/permissions.ts ──────────────
// Canonical literal — values AND structure must match the server module.
// Single-sided edits (server or web) break this test on the unchanged side,
// surfacing drift in CI, exactly like the orgMembers/orgEnums contract tests.
const CANONICAL: Record<OrgMemberRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'medical.read'),
  head_coach: [
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
  ],
  assistant_coach: [
    'team.read',
    'analysis.create',
    'analysis.read',
    'player.read',
    'report.read',
    'report.create',
    'finding.review',
  ],
  coach: [
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
  ],
  analyst: [
    'team.read',
    'analysis.create',
    'analysis.read',
    'player.read',
    'report.read',
    'report.create',
    'finding.review',
  ],
  medical: ['team.read', 'player.read', 'report.read', 'medical.read'],
  player: ['analysis.read', 'report.read'],
}

// Route floors as mounted by the server (guards are server-side; these lists
// pin the UI mirror).
const CANONICAL_REPORT_SEND: readonly OrgMemberRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
]
const CANONICAL_TEAM_DELETE: readonly OrgMemberRole[] = ['owner', 'admin']
const CANONICAL_MEMBER_INVITE: readonly OrgMemberRole[] = ['owner', 'admin']

describe('permissions vocabulary', () => {
  test('covers every org member role exactly', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ORG_MEMBER_ROLES].sort())
  })

  test('permission vocabulary is unique', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })

  test('every role grants only known permissions', () => {
    for (const role of ORG_MEMBER_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission)
      }
    }
  })
})

describe('role → permission matrix (mirrors the server)', () => {
  test('matrix matches the canonical server literal for every role', () => {
    for (const role of ORG_MEMBER_ROLES) {
      expect([...ROLE_PERMISSIONS[role]].sort(), `role: ${role}`).toEqual(
        [...CANONICAL[role]].sort(),
      )
    }
  })

  test('hasPermission is false for a null/unresolved role', () => {
    expect(hasPermission(null, 'team.read')).toBe(false)
    expect(hasPermission(undefined, 'report.read')).toBe(false)
  })

  test('owner holds every permission, admin holds all but medical.read', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('owner', permission)).toBe(true)
      expect(hasPermission('admin', permission)).toBe(permission !== 'medical.read')
    }
  })

  test('medical is read-scoped: no analysis.read, no report.create, no player.manage', () => {
    expect(hasPermission('medical', 'medical.read')).toBe(true)
    expect(hasPermission('medical', 'analysis.read')).toBe(false)
    expect(hasPermission('medical', 'report.create')).toBe(false)
    expect(hasPermission('medical', 'player.manage')).toBe(false)
    expect(hasPermission('medical', 'team.manage')).toBe(false)
  })

  test('player is self-service: analysis.read + report.read only', () => {
    expect(CANONICAL.player).toEqual(['analysis.read', 'report.read'])
    expect(hasPermission('player', 'team.read')).toBe(false)
    expect(hasPermission('player', 'player.read')).toBe(false)
  })

  test('assistant coach and analyst share the COACH set minus team.manage and player.manage', () => {
    for (const role of ['assistant_coach', 'analyst'] as const) {
      expect(hasPermission(role, 'team.manage')).toBe(false)
      expect(hasPermission(role, 'team.manage_members')).toBe(false)
      expect(hasPermission(role, 'player.manage')).toBe(false)
      expect(hasPermission(role, 'team.read')).toBe(true)
      expect(hasPermission(role, 'report.create')).toBe(true)
    }
  })
})

describe('route floors pinned from server guards', () => {
  test('report send floor matches server/src/index.ts email guard', () => {
    expect([...REPORT_SEND_ROLES].sort()).toEqual([...CANONICAL_REPORT_SEND].sort())
  })

  test('team delete floor matches the server/src/routes/teams.ts owner/admin floor', () => {
    expect([...TEAM_DELETE_ROLES].sort()).toEqual([...CANONICAL_TEAM_DELETE].sort())
  })

  test('member invite floor matches server/src/routes/members.ts invite guards', () => {
    expect([...MEMBER_INVITE_ROLES].sort()).toEqual([...CANONICAL_MEMBER_INVITE].sort())
  })

  test('floors only ever name real roles', () => {
    for (const role of [...REPORT_SEND_ROLES, ...TEAM_DELETE_ROLES, ...MEMBER_INVITE_ROLES]) {
      expect(ORG_MEMBER_ROLES).toContain(role)
    }
  })

  test('every send-capable role also holds report.create (floor ⊆ matrix)', () => {
    // The email floor is narrower than report.create (analysts are excluded);
    // if it ever names a role without report.create the two sides disagree.
    for (const role of REPORT_SEND_ROLES) {
      expect(hasPermission(role, 'report.create'), `role: ${role}`).toBe(true)
    }
  })

  test('every delete-capable role also holds team.manage', () => {
    for (const role of TEAM_DELETE_ROLES) {
      expect(hasPermission(role, 'team.manage'), `role: ${role}`).toBe(true)
    }
  })
})
