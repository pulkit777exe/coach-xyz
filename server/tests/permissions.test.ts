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

  test('head coach manages players and analyses but not medical by default', () => {
    expect(hasPermission('head_coach', 'analysis.create')).toBe(true)
    expect(hasPermission('head_coach', 'player.manage')).toBe(true)
    expect(hasPermission('head_coach', 'finding.review')).toBe(true)
    expect(hasPermission('head_coach', 'team.manage')).toBe(true)
    expect(hasPermission('head_coach', 'team.create')).toBe(false)
    expect(hasPermission('head_coach', 'org.manage_members')).toBe(false)
    expect(hasPermission('head_coach', 'org.invite')).toBe(true)
    expect(hasPermission('head_coach', 'medical.read')).toBe(false)
  })

  test('junior coach is scoped to analysis and roster reads', () => {
    expect(hasPermission('junior_coach', 'analysis.create')).toBe(true)
    expect(hasPermission('junior_coach', 'analysis.read')).toBe(true)
    expect(hasPermission('junior_coach', 'player.read')).toBe(true)
    expect(hasPermission('junior_coach', 'report.read')).toBe(true)
    expect(hasPermission('junior_coach', 'team.read')).toBe(true)
    expect(hasPermission('junior_coach', 'player.manage')).toBe(false)
    expect(hasPermission('junior_coach', 'team.manage')).toBe(false)
    expect(hasPermission('junior_coach', 'org.invite')).toBe(false)
    expect(hasPermission('junior_coach', 'medical.read')).toBe(false)
  })

  test('junior coach gains medical.read via grant', () => {
    expect(hasPermission('junior_coach', 'medical.read', ['medical.read'])).toBe(true)
  })

  test('player is read-only on own scope', () => {
    expect(hasPermission('player', 'analysis.read')).toBe(true)
    expect(hasPermission('player', 'report.read')).toBe(true)
    expect(hasPermission('player', 'analysis.create')).toBe(false)
    expect(hasPermission('player', 'team.read')).toBe(true)
  })

  test('null role holds nothing', () => {
    expect(hasPermission(null, 'team.read')).toBe(false)
  })

  test('permission vocabulary has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})

describe('canAccessTeam', () => {
  test('owner bypasses team scope', () => {
    expect(canAccessTeam('owner', [], 'team-1')).toBe(true)
  })

  test('head/junior coaches need a membership on that team', () => {
    expect(canAccessTeam('head_coach', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('head_coach', ['team-2'], 'team-1')).toBe(false)
    expect(canAccessTeam('junior_coach', ['team-1'], 'team-1')).toBe(true)
    expect(canAccessTeam('junior_coach', [], 'team-1')).toBe(false)
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
    expect(maySeeMedical('owner', false)).toBe(true)
    expect(maySeeMedical(null, true)).toBe(true)
  })

  test('granted junior coach sees wellness; others do not', () => {
    expect(maySeeMedical('junior_coach', false, ['medical.read'])).toBe(true)
    expect(maySeeMedical('junior_coach', false)).toBe(false)
    expect(maySeeMedical('head_coach', false)).toBe(false)
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
  test('owner sees the whole roster', () => {
    expect(resolveStudentScope('owner', ['t1'])).toEqual({ all: true })
  })

  test('staff see only their teams', () => {
    expect(resolveStudentScope('head_coach', ['t1', 't2'])).toEqual({
      all: false,
      teamIds: ['t1', 't2'],
    })
    expect(resolveStudentScope('junior_coach', [])).toEqual({
      all: false,
      teamIds: [],
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
