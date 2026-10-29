import { getMemberAccess, type OrgMemberRole } from './orgMembers'

// getMemberAccess lives in orgMembers; this module must not be imported from
// there (grants stay string[] on the row, parsed here).

// ── Access resolver ──────────────────────────────────────────────────────────
// Every request answers three questions here: who is acting, in which
// organisation, with which role/scope/grants. Module routes ask `decide`
// (or the Caller wrappers) — they never re-literalize role lists.

export const PERMISSIONS = [
  'org.invite',
  'org.manage_members',
  'org.audit',
  'org.settings',
  'org.billing',
  'org.export',
  'team.create',
  'team.delete',
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
  'report.export',
  'finding.review',
  'medical.read',
  'attendance.mark',
  'schedule.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const GRANTS = ['medical.read', 'billing.view', 'analysis.upload_own'] as const
export type Grant = (typeof GRANTS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const HEAD_COACH_PERMISSIONS: readonly Permission[] = [
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
  'schedule.manage',
]

const JUNIOR_COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'report.read',
  'report.create',
  'attendance.mark',
]

const PLAYER_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.read',
  'report.read',
]

const ROLE_PERMISSIONS: Record<OrgMemberRole, readonly Permission[]> = {
  owner: ALL,
  head_coach: HEAD_COACH_PERMISSIONS,
  junior_coach: JUNIOR_COACH_PERMISSIONS,
  player: PLAYER_PERMISSIONS,
}

export type AccessScope = 'org' | 'teams' | 'self' | 'none'

export function accessScope(role: OrgMemberRole | null): AccessScope {
  if (role === 'owner') return 'org'
  if (role === 'head_coach' || role === 'junior_coach') return 'teams'
  if (role === 'player') return 'self'
  return 'none'
}

export type AccessSubject = {
  actorId: string
  orgId: string
  role: OrgMemberRole | null
  teamIds: readonly string[]
  grants: readonly Grant[]
}

export type AccessResource = {
  orgId: string
  teamId?: string | null
  ownerId?: string | null
  inviteRole?: OrgMemberRole | null
}

export type AccessDecision = {
  allow: boolean
  scope: AccessScope
  reasons: string[]
}

const GRANT_SET: ReadonlySet<string> = new Set(GRANTS)

export function parseGrants(raw: unknown): Grant[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((g): g is Grant => typeof g === 'string' && GRANT_SET.has(g))
}

/** Role table plus owner-granted flags. This is the permission half of decide(). */
export function hasPermission(
  role: OrgMemberRole | null,
  permission: Permission,
  grants: readonly Grant[] = [],
): boolean {
  if (!role) return false
  if (ROLE_PERMISSIONS[role]?.includes(permission)) return true
  if (permission === 'medical.read' && grants.includes('medical.read')) return true
  if (permission === 'org.billing' && grants.includes('billing.view')) return true
  if (permission === 'analysis.create' && grants.includes('analysis.upload_own')) return true
  return false
}

export function canAssignRole(
  actorRole: OrgMemberRole | null,
  targetRole: OrgMemberRole,
): boolean {
  if (actorRole === 'owner') {
    return targetRole === 'head_coach' || targetRole === 'junior_coach' || targetRole === 'player'
  }
  if (actorRole === 'head_coach') {
    return targetRole === 'junior_coach' || targetRole === 'player'
  }
  return false
}

/**
 * Team-scope check: owners bypass; head/junior coaches must hold a membership;
 * players never manage a team (self-scope only).
 */
export function canAccessTeam(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
  teamId: string,
): boolean {
  if (role === 'owner') return true
  if (role === 'head_coach' || role === 'junior_coach') {
    return memberTeamIds.includes(teamId)
  }
  return false
}

/** Read visibility for a team, including a player looking at their own team. */
export function canSeeTeam(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
  teamId: string,
): boolean {
  if (canAccessTeam(role, memberTeamIds, teamId)) return true
  if (role === 'player') return memberTeamIds.includes(teamId)
  return false
}

export function resolveStudentScope(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
): { all: true } | { all: false; teamIds: string[] } {
  if (role === 'owner') return { all: true }
  if (role === 'head_coach' || role === 'junior_coach') {
    return { all: false, teamIds: [...memberTeamIds] }
  }
  return { all: false, teamIds: [] }
}

export function maySeeMedical(
  role: OrgMemberRole | null,
  isOwner: boolean,
  grants: readonly Grant[] = [],
): boolean {
  if (isOwner || role === 'owner') return true
  return hasPermission(role, 'medical.read', grants)
}

/** Resolve medical visibility for an analysis owned by `ownerAuth0Id`. */
export async function resolveMedicalAccess(
  ownerAuth0Id: string | null,
  callerSub: string | null,
): Promise<boolean> {
  if (!ownerAuth0Id || !callerSub) return false
  if (callerSub === ownerAuth0Id) return true
  try {
    const access = await getMemberAccess(ownerAuth0Id, callerSub)
    if (!access) return false
    return maySeeMedical(access.role, access.role === 'owner', parseGrants(access.grants))
  } catch {
    return false
  }
}

/** Strip wellness keys from a summary (pure; returns the input when clean). */
export function redactWellness(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return summary
  const copy = { ...(summary as Record<string, unknown>) }
  const events = copy.shot_events
  if (Array.isArray(events)) {
    copy.shot_events = events.map((e) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return e
      const { injury_risk: _dropped, ...rest } = e as Record<string, unknown>
      return rest
    })
  }
  return copy
}

const TEAM_GATED: ReadonlySet<Permission> = new Set([
  'team.manage',
  'team.manage_members',
  'team.delete',
  'player.manage',
  'analysis.create',
  'finding.review',
  'report.create',
  'report.publish',
  'report.delete',
  'attendance.mark',
  'schedule.manage',
  'medical.read',
])

/**
 * Single decision point: can this subject perform `action` on `resource`?
 * Reasons are written for the owner “why can they see this?” view.
 */
export function decide(
  subject: AccessSubject,
  action: Permission,
  resource: AccessResource,
): AccessDecision {
  const scope = accessScope(subject.role)
  const reasons: string[] = []

  if (!subject.role) {
    return { allow: false, scope: 'none', reasons: ['Not a member of this organisation'] }
  }
  if (subject.orgId !== resource.orgId) {
    return {
      allow: false,
      scope: 'none',
      reasons: ['Actor belongs to a different organisation'],
    }
  }

  reasons.push(`Role is ${subject.role.replace('_', ' ')}`)
  if (subject.grants.length > 0) {
    reasons.push(`Granted: ${subject.grants.join(', ')}`)
  }

  if (action === 'org.invite' && resource.inviteRole) {
    if (!canAssignRole(subject.role, resource.inviteRole)) {
      return {
        allow: false,
        scope,
        reasons: [
          ...reasons,
          `${subject.role.replace('_', ' ')} cannot invite a ${resource.inviteRole.replace('_', ' ')}`,
        ],
      }
    }
    reasons.push(`May invite ${resource.inviteRole.replace('_', ' ')}`)
  }

  if (!hasPermission(subject.role, action, subject.grants)) {
    return {
      allow: false,
      scope,
      reasons: [...reasons, `Role does not grant ${action}`],
    }
  }

  if (subject.role === 'player' && resource.ownerId && resource.ownerId !== subject.actorId) {
    return {
      allow: false,
      scope: 'self',
      reasons: [...reasons, 'Players may only act on their own record'],
    }
  }

  if (resource.teamId) {
    const see =
      action === 'team.read' || action === 'analysis.read' || action === 'report.read'
        ? canSeeTeam(subject.role, subject.teamIds, resource.teamId)
        : canAccessTeam(subject.role, subject.teamIds, resource.teamId)
    if (!see) {
      return {
        allow: false,
        scope,
        reasons: [...reasons, 'Not assigned to this team'],
      }
    }
    if (subject.role !== 'owner') {
      reasons.push('Assigned to the team in scope')
    }
  } else if (TEAM_GATED.has(action) && subject.role !== 'owner' && subject.role !== 'player') {
    reasons.push('Allowed on assigned teams only')
  }

  return { allow: true, scope, reasons }
}
