import { describe, expect, test } from 'vitest'
import { ORG_MEMBER_ROLES, type OrgMemberRole } from '@/lib/members'
import {
  AUTH_USER_ALLOWED_MEMBER_ROLES,
  MEMBER_INVITE_ROLES,
  PERMISSIONS,
  REPORT_SEND_ROLES,
  ROLE_PERMISSIONS,
  TEAM_DELETE_ROLES,
  analysisDetailCapabilities,
  dashboardQuickActions,
  hasPermission,
  type Permission,
} from '@/lib/permissions'

// ── Contract: web matrix mirrors server/src/lib/permissions.ts ──────────────
// Canonical literal — values AND structure must match the server module.
// Single-sided edits (server or web) break this test on the unchanged side,
// surfacing drift in CI, exactly like the orgMembers/orgEnums contract tests.
const CANONICAL: Record<OrgMemberRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  head_coach: [
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
  ],
  junior_coach: [
    'team.read',
    'analysis.create',
    'analysis.read',
    'player.read',
    'report.read',
    'report.create',
    'attendance.mark',
    'attendance.write',
  ],
  player: ['analysis.read', 'report.read', 'team.read'],
}

// Route floors as mounted by the server (guards are server-side; these lists
// pin the UI mirror).
const CANONICAL_REPORT_SEND: readonly OrgMemberRole[] = [
  'owner',
  'head_coach',
  'junior_coach',
]
const CANONICAL_TEAM_DELETE: readonly OrgMemberRole[] = ['owner']
const CANONICAL_MEMBER_INVITE: readonly OrgMemberRole[] = ['owner', 'head_coach']

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

  test('attendance.write is held by the coaching roles only', () => {
    for (const role of ['owner', 'head_coach', 'junior_coach'] as const) {
      expect(hasPermission(role, 'attendance.write'), `role: ${role}`).toBe(true)
    }
    for (const role of ['player'] as const) {
      expect(hasPermission(role, 'attendance.write'), `role: ${role}`).toBe(false)
    }
  })

  test('owner holds every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('owner', permission)).toBe(true)
    }
  })

  test('player is self-service: analysis.read + report.read + team.read only', () => {
    expect([...CANONICAL.player].sort()).toEqual(['analysis.read', 'report.read', 'team.read'].sort())
    expect(hasPermission('player', 'player.read')).toBe(false)
  })
})

describe('route floors pinned from server guards', () => {
  test('report send floor matches server/src/index.ts email guard', () => {
    expect([...REPORT_SEND_ROLES].sort()).toEqual([...CANONICAL_REPORT_SEND].sort())
  })

  test('team delete floor matches the server/src/routes/teams.ts owner floor', () => {
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

describe('analysis detail capabilities', () => {
  test.each([
    ['owner', true, true],
    ['head_coach', true, true],
    ['junior_coach', true, false],
    ['player', false, false],
  ] as const)('%s share=%s link=%s', (role, canShareTokens, canLinkToStudent) => {
    expect(analysisDetailCapabilities(role)).toEqual({ canShareTokens, canLinkToStudent })
  })

  test('an unresolved role receives neither action', () => {
    expect(analysisDetailCapabilities(null)).toEqual({
      canShareTokens: false,
      canLinkToStudent: false,
    })
  })
})

describe('dashboard quick actions (landing tiles stay honest)', () => {
  test('New analysis tile follows analysis.create + analysis.read', () => {
    for (const role of ORG_MEMBER_ROLES) {
      const expected =
        hasPermission(role, 'analysis.create') && hasPermission(role, 'analysis.read')
      expect(dashboardQuickActions(role).analyze, `role: ${role}`).toBe(expected)
    }
    expect(dashboardQuickActions(null).analyze).toBe(false)
  })

  test('Add student tile follows player.manage; Invite tile follows the invite floor', () => {
    for (const role of ORG_MEMBER_ROLES) {
      const caps = dashboardQuickActions(role)
      expect(caps.manageStudents, `role: ${role}`).toBe(hasPermission(role, 'player.manage'))
      expect(caps.invite, `role: ${role}`).toBe(MEMBER_INVITE_ROLES.includes(role))
    }
    expect(dashboardQuickActions('owner').invite).toBe(true)
    expect(dashboardQuickActions('head_coach').invite).toBe(true)
    expect(dashboardQuickActions('junior_coach').invite).toBe(false)
    expect(dashboardQuickActions('player').invite).toBe(false)
  })

  test('Schedule tile is staff-only; an unresolved role gets no tiles at all', () => {
    for (const role of ORG_MEMBER_ROLES) {
      expect(dashboardQuickActions(role).schedule, `role: ${role}`).toBe(role !== 'player')
    }
    expect(dashboardQuickActions(null)).toEqual({
      analyze: false,
      manageStudents: false,
      schedule: false,
      invite: false,
    })
  })
})

describe('auth-user cross-account floor (dashboard stats + analyses)', () => {
  test('mirrors the server list exactly', () => {
    expect([...AUTH_USER_ALLOWED_MEMBER_ROLES]).toEqual([
      'owner',
      'head_coach',
      'junior_coach',
    ])
  })

  test('every floor member holds analysis.read; players never do', () => {
    for (const role of AUTH_USER_ALLOWED_MEMBER_ROLES) {
      expect(hasPermission(role, 'analysis.read'), `role: ${role}`).toBe(true)
    }
    expect(AUTH_USER_ALLOWED_MEMBER_ROLES.includes('player')).toBe(false)
  })
})
