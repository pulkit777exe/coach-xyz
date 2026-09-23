import { getTeam } from '../../lib/teams'
import { resolveCaller } from '../../lib/caller'
import { UUID_RE } from '../../lib/uuid'
import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
} from '../../lib/orgEnums'
import type { ScheduleInput, StudentInput } from '../../lib/orgData'

export const ATTENDANCE_STATUS_SET: ReadonlySet<string> = new Set(ATTENDANCE_STATUSES)
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES)
export const EVENT_STATUS_SET: ReadonlySet<string> = new Set(EVENT_STATUSES)
export const STUDENT_STATUS_SET: ReadonlySet<string> = new Set(STUDENT_STATUSES)
export const REPORT_TYPE_SET: ReadonlySet<string> = new Set(REPORT_TYPES)

// Re-export the single UUID pattern (lib/uuid) for org route modules.
export { UUID_RE }

/**
 * Hierarchy scope for roster reads (§3: owner → coaches → players).
 * Owners/admins see all; staff see their teams' students only.
 */
export const studentScope = async (
  orgAuth0Id: string,
  request: Request,
): Promise<{ all: true } | { all: false; teamIds: string[] }> => {
  return (await resolveCaller(orgAuth0Id, request)).studentScope
}

/**
 * Validate an optional team assignment: null/"" clears it, otherwise the
 * team must exist in this org (prevents cross-org linkage).
 */
export const resolveTeamId = async (
  auth0Id: string,
  raw: unknown,
): Promise<{ ok: true; teamId: string | null } | { ok: false; error: string }> => {
  if (raw === undefined || raw === null || raw === '') return { ok: true, teamId: null }
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    return { ok: false, error: 'team_id must be a valid UUID or null' }
  }
  const team = await getTeam(auth0Id, raw)
  if (!team) return { ok: false, error: 'team not found in this organization' }
  return { ok: true, teamId: raw }
}

export const parseStudentInput = (body: Record<string, unknown>) => {
  const input: StudentInput = {}
  const fields = [
    'full_name',
    'email',
    'phone',
    'sport',
    'position',
    'jersey_number',
    'date_of_birth',
    'gender',
    'guardian_name',
    'guardian_phone',
    'notes',
    'status',
    'joined_on',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

export const parseScheduleInput = (body: Record<string, unknown>) => {
  const input: ScheduleInput = {}
  const fields = [
    'title',
    'event_type',
    'starts_at',
    'ends_at',
    'location',
    'description',
    'status',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}
