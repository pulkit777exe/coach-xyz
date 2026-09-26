import { getMemberRole, type OrgMemberRole } from './orgMembers'

// ── Permission vocabulary (§4) ───────────────────────────────────────────────
// Roles grant membership; permissions grant actions; team scope narrows WHERE.
// `hasPermission` is the pure decision point — route guards resolve the
// caller's org role, then check the required permission here instead of
// re-literalizing role lists per route.

export const PERMISSIONS = [
  'org.invite',
  'org.manage_members',
  'team.create',
  'team.manage',
  'team.manage_members',
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'attendance.write',
  'report.read',
  'report.create',
  'finding.review',
  'medical.read',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: readonly Permission[] = PERMISSIONS

const COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'team.manage',
  'team.manage_members',
  'analysis.create',
  'analysis.read',
  'player.read',
  'player.manage',
  'attendance.write',
  'report.read',
  'report.create',
  'finding.review',
]

const ANALYST_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'report.read',
  'report.create',
  'finding.review',
]

// Assistant coaches run sessions and review findings but cannot reshape teams
// or manage the roster — head coaches (and the legacy `coach` alias) can.
// They do run attendance, so `attendance.write` stays with them.
const ASSISTANT_COACH_PERMISSIONS: readonly Permission[] = [
  'team.read',
  'analysis.create',
  'analysis.read',
  'player.read',
  'attendance.write',
  'report.read',
  'report.create',
  'finding.review',
]

const ROLE_PERMISSIONS: Record<OrgMemberRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'medical.read'),
  head_coach: COACH_PERMISSIONS,
  assistant_coach: ASSISTANT_COACH_PERMISSIONS,
  coach: COACH_PERMISSIONS,
  analyst: ANALYST_PERMISSIONS,
  medical: ['team.read', 'player.read', 'report.read', 'medical.read'],
  player: ['analysis.read', 'report.read'],
}

/** Pure permission check: does this org role grant the permission? */
export function hasPermission(role: OrgMemberRole | null, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Pure team-scope check: is the caller allowed to act on this team?
 * Owners/admins bypass scope; coaches/analysts/medical must hold a team
 * membership; players never act on teams (self-scope only).
 */
export function canAccessTeam(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
  teamId: string,
): boolean {
  if (role === 'owner' || role === 'admin') return true
  if (
    role === 'head_coach' ||
    role === 'assistant_coach' ||
    role === 'coach' ||
    role === 'analyst' ||
    role === 'medical'
  ) {
    return memberTeamIds.includes(teamId)
  }
  return false
}

// ── Health-data boundary (§5) ───────────────────────────────────────────────
// injury_risk and other wellness signals ride inside analysis summaries but
// must not behave like ordinary statistics: only the owning account and the
// medical role may see them. Everyone else gets the summary with wellness
// keys stripped (scores, feedback, and findings stay intact).

/**
 * Pure student-visibility scope (§3 hierarchy: owner → coaches → players).
 * Owners/admins see the whole org roster; coaches, analysts, and medical
 * staff see only students on their assigned teams.
 */
export function resolveStudentScope(
  role: OrgMemberRole | null,
  memberTeamIds: readonly string[],
): { all: true } | { all: false; teamIds: string[] } {
  if (role === 'owner' || role === 'admin') return { all: true }
  if (
    role === 'head_coach' ||
    role === 'assistant_coach' ||
    role === 'coach' ||
    role === 'analyst' ||
    role === 'medical'
  ) {
    return { all: false, teamIds: [...memberTeamIds] }
  }
  return { all: false, teamIds: [] }
}

/** Roles allowed to see wellness signals inside summaries. */
export function maySeeMedical(role: OrgMemberRole | null, isOwner: boolean): boolean {
  if (isOwner) return true
  return role === 'medical'
}

/** Resolve medical visibility for an analysis owned by `ownerAuth0Id`. */
export async function resolveMedicalAccess(
  ownerAuth0Id: string | null,
  callerSub: string | null,
): Promise<boolean> {
  if (!ownerAuth0Id || !callerSub) return false
  if (callerSub === ownerAuth0Id) return true
  try {
    const role = await getMemberRole(ownerAuth0Id, callerSub)
    return role === 'owner' || role === 'medical'
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
