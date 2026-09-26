import { describe, expect, test } from 'bun:test'

import {
  PERMISSIONS,
  canAccessTeam,
  hasPermission,
  maySeeMedical,
  redactWellness,
  resolveMedicalAccess,
  resolveStudentScope,
} from '../src/lib/permissions'

describe('hasPermission', () => {
  test('owner holds every permission', () => {
    for (const p of PERMISSIONS) {
      expect(hasPermission('owner', p)).toBe(true)
    }
  })

  test('admin holds everything except medical.read', () => {
    expect(hasPermission('admin', 'medical.read')).toBe(false)
    expect(hasPermission('admin', 'org.manage_members')).toBe(true)
    expect(hasPermission('admin', 'analysis.create')).toBe(true)
  })

  test('coach can manage players and analyses but not members or medical', () => {
    expect(hasPermission('coach', 'analysis.create')).toBe(true)
    expect(hasPermission('coach', 'player.manage')).toBe(true)
    expect(hasPermission('coach', 'finding.review')).toBe(true)
    expect(hasPermission('coach', 'team.manage')).toBe(true)
    expect(hasPermission('coach', 'team.create')).toBe(false)
    expect(hasPermission('coach', 'org.manage_members')).toBe(false)
    expect(hasPermission('coach', 'org.invite')).toBe(false)
    expect(hasPermission('coach', 'medical.read')).toBe(false)
  })

  test('head coach matches the legacy coach track; assistant is scoped', () => {
    for (const p of [
      'analysis.create',
      'player.manage',
      'team.manage',
      'finding.review',
    ] as const) {
      expect(hasPermission('head_coach', p)).toBe(hasPermission('coach', p))
    }
    expect(hasPermission('head_coach', 'team.manage')).toBe(true)
    expect(hasPermission('head_coach', 'player.manage')).toBe(true)
    expect(hasPermission('assistant_coach', 'analysis.create')).toBe(true)
    expect(hasPermission('assistant_coach', 'finding.review')).toBe(true)
    expect(hasPermission('assistant_coach', 'team.manage')).toBe(false)
    expect(hasPermission('assistant_coach', 'player.manage')).toBe(false)
    expect(hasPermission('assistant_coach', 'org.manage_members')).toBe(false)
    expect(hasPermission('assistant_coach', 'medical.read')).toBe(false)
  })

  test('analyst analyzes and reports without membership management', () => {
    expect(hasPermission('analyst', 'analysis.create')).toBe(true)
    expect(hasPermission('analyst', 'report.create')).toBe(true)
    expect(hasPermission('analyst', 'finding.review')).toBe(true)
    expect(hasPermission('analyst', 'player.manage')).toBe(false)
    expect(hasPermission('analyst', 'team.manage')).toBe(false)
  })

  test('medical reads team/player/report + medical only', () => {
    expect(hasPermission('medical', 'medical.read')).toBe(true)
    expect(hasPermission('medical', 'player.read')).toBe(true)
    expect(hasPermission('medical', 'analysis.create')).toBe(false)
    expect(hasPermission('medical', 'player.manage')).toBe(false)
  })

  // Attendance and schedule writes used to ride the broad org floor, so an
  // analyst or a medical user could write player records. `attendance.write`
  // is the capability that runs a session; read-only roles must not hold it,
  // and assistant coaches must keep it because running the session is their job.
  test('attendance.write is held by the coaching roles only', () => {
    for (const role of ['owner', 'admin', 'head_coach', 'coach', 'assistant_coach'] as const) {
      expect(hasPermission(role, 'attendance.write'), `role: ${role}`).toBe(true)
    }
    for (const role of ['analyst', 'medical', 'player'] as const) {
      expect(hasPermission(role, 'attendance.write'), `role: ${role}`).toBe(false)
    }
  })

  test('player is read-only on own scope', () => {
    expect(hasPermission('player', 'analysis.read')).toBe(true)
    expect(hasPermission('player', 'report.read')).toBe(true)
    expect(hasPermission('player', 'analysis.create')).toBe(false)
    expect(hasPermission('player', 'team.read')).toBe(false)
  })

  test('null role holds nothing', () => {
    expect(hasPermission(null, 'team.read')).toBe(false)
  })

  test('permission vocabulary has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})

describe('canAccessTeam', () => {
  test('owner and admin bypass team scope', () => {
    expect(canAccessTeam('owner', [], 'team-1')).toBe(true)
    expect(canAccessTeam('admin', [], 'team-1')).toBe(true)
  })

  test('coaches need a membership on that team', () => {
    expect(canAccessTeam('coach', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('coach', ['team-2'], 'team-1')).toBe(false)
  })

  test('org staff reach every team without a membership', () => {
    // Matches resolveStudentScope: analyst/medical are org-level readers, so
    // a membership must not be the only way they see a team.
    expect(canAccessTeam('analyst', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('analyst', [], 'team-1')).toBe(true)
    expect(canAccessTeam('medical', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('medical', [], 'team-1')).toBe(true)
  })

  test('head/assistant coaches need a membership on that team', () => {
    expect(canAccessTeam('head_coach', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('head_coach', ['team-2'], 'team-1')).toBe(false)
    expect(canAccessTeam('assistant_coach', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('assistant_coach', [], 'team-1')).toBe(false)
  })

  test('player never passes team scope (self-scope only)', () => {
    expect(canAccessTeam('player', ['team-1'], 'team-1')).toBe(false)
  })

  test('null role never passes', () => {
    expect(canAccessTeam(null, ['team-1'], 'team-1')).toBe(false)
  })
})

describe('medical boundary', () => {
  test('owner always sees wellness signals', () => {
    expect(maySeeMedical('coach', true)).toBe(true)
    expect(maySeeMedical(null, true)).toBe(true)
  })

  test('only the medical role sees them otherwise', () => {
    expect(maySeeMedical('medical', false)).toBe(true)
    expect(maySeeMedical('coach', false)).toBe(false)
    expect(maySeeMedical('analyst', false)).toBe(false)
    expect(maySeeMedical('player', false)).toBe(false)
    expect(maySeeMedical(null, false)).toBe(false)
  })

  test('redactWellness strips injury_risk but keeps scores and feedback', () => {
    const summary = {
      form_score: 7,
      shot_events: [
        {
          timestamp: 1,
          form_score: 7,
          feedback: 'good',
          injury_risk: { level: 'high' },
        },
        { timestamp: 2, form_score: 8, feedback: 'great' },
      ],
    }
    const redacted = redactWellness(summary) as typeof summary
    expect(redacted.form_score).toBe(7)
    expect(redacted.shot_events[0]).not.toHaveProperty('injury_risk')
    expect(redacted.shot_events[0].feedback).toBe('good')
    expect(redacted.shot_events[1].feedback).toBe('great')
  })

  test('redactWellness passes through non-summaries', () => {
    expect(redactWellness(null)).toBeNull()
    expect(redactWellness('x')).toBe('x')
    expect(redactWellness([1])).toEqual([1])
  })

  test('resolveMedicalAccess allows the owning account without a DB', async () => {
    await expect(resolveMedicalAccess('auth0|a', 'auth0|a')).resolves.toBe(true)
    await expect(resolveMedicalAccess(null, 'auth0|a')).resolves.toBe(false)
    await expect(resolveMedicalAccess('auth0|a', null)).resolves.toBe(false)
  })
})

describe('resolveStudentScope', () => {
  test('owner and admin see the whole roster', () => {
    expect(resolveStudentScope('owner', ['t1'])).toEqual({ all: true })
    expect(resolveStudentScope('admin', [])).toEqual({ all: true })
  })

  test('team staff see only their teams', () => {
    expect(resolveStudentScope('coach', ['t1', 't2'])).toEqual({
      all: false,
      teamIds: ['t1', 't2'],
    })
  })

  test('org staff (analyst, medical) see the whole org, teams or not', () => {
    // Read-only specialists are not assigned to a team; scoping them by
    // membership would leave the app empty for them.
    expect(resolveStudentScope('analyst', [])).toEqual({ all: true })
    expect(resolveStudentScope('medical', [])).toEqual({ all: true })
    // A team membership does not narrow them further.
    expect(resolveStudentScope('analyst', ['t9'])).toEqual({ all: true })
    expect(resolveStudentScope('medical', ['t9'])).toEqual({ all: true })
  })

  test('an unassigned coach sees nothing rather than everything', () => {
    expect(resolveStudentScope('coach', [])).toEqual({ all: false, teamIds: [] })
    expect(resolveStudentScope('head_coach', [])).toEqual({ all: false, teamIds: [] })
  })

  test('coaching tracks see only their teams', () => {
    expect(resolveStudentScope('head_coach', ['t1'])).toEqual({
      all: false,
      teamIds: ['t1'],
    })
    expect(resolveStudentScope('assistant_coach', ['t2'])).toEqual({
      all: false,
      teamIds: ['t2'],
    })
  })

  test('players and strangers see nothing', () => {
    expect(resolveStudentScope('player', ['t1'])).toEqual({
      all: false,
      teamIds: [],
    })
    expect(resolveStudentScope(null, ['t1'])).toEqual({
      all: false,
      teamIds: [],
    })
  })
})
