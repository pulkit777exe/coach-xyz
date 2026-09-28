import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamMembership,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  renameTeam,
  setStudentTeam,
} from '../lib/teams'
import { orgRoleGuard, serviceGuard } from '../lib/serviceGuard'
import { type Permission } from '../lib/permissions'
import { auditRoute, type AuditAction } from '../lib/audit'
import { resolveCaller, type Caller } from '../lib/caller'
import { UUID_RE } from '../lib/uuid'

const forbid = (set: { status?: number | string }) => {
  set.status = 403
  return buildError('FORBIDDEN', 'Insufficient role for this organization', false)
}

const logTeamAudit = (
  request: Request,
  orgAuth0Id: string,
  action: AuditAction,
  teamId: string,
  meta?: Record<string, unknown>,
) => {
  auditRoute(request, orgAuth0Id, action, 'team', teamId, meta)
}

/** Guard: membership + permission + (for team-scoped routes) team scope. */
const guard = async (
  orgAuth0Id: string,
  request: Request,
  set: { status?: number | string },
  permission: Permission,
  teamId?: string,
): Promise<{ caller: Caller } | ReturnType<typeof buildError>> => {
  const caller = await resolveCaller(orgAuth0Id, request)
  if (!caller.role || !caller.can(permission)) return forbid(set)
  if (teamId && !caller.canAccessTeam(teamId)) return forbid(set)
  return { caller }
}

// Team management routes. orgRoleGuard keeps every route member-scoped;
// in-handler permission + team-scope checks layer §4 semantics on top.
export default new Elysia()
  .use(serviceGuard)
  .use(
    new Elysia()
      .use(
        orgRoleGuard([
          'owner',
          'admin',
          'head_coach',
          'assistant_coach',
          'coach',
          'analyst',
          'medical',
          'player',
        ]),
      )
      .get('/api/org/:auth0Id/teams', async ({ params, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const caller = await resolveCaller(auth0Id, request)
        if (!caller.can('team.read')) return forbid(set)
        const all = await listTeams(auth0Id)
        // Filter through canAccessTeam rather than caller.teamIds directly:
        // org staff reach every team by policy, so comparing raw membership
        // ids would show them an empty list while their member reads work.
        set.status = 200
        return { teams: all.filter((t) => caller.canAccessTeam(t.id)) }
      })
      .post('/api/org/:auth0Id/teams', async ({ params, request, body, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const g = await guard(auth0Id, request, set, 'team.create')
        if (!('caller' in g)) return g
        const { name, sport } = (body ?? {}) as {
          name?: unknown
          sport?: unknown
        }
        if (typeof name !== 'string' || !name.trim()) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'name is required', false)
        }
        if (sport !== undefined && sport !== null && typeof sport !== 'string') {
          set.status = 400
          return buildError('INVALID_REQUEST', 'sport must be a string', false)
        }
        const team = await createTeam(auth0Id, {
          name,
          sport: typeof sport === 'string' ? sport : null,
        })
        if (!team) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Could not create team', false)
        }
        logTeamAudit(request, auth0Id, 'team.created', team.id, {
          name: team.name,
        })
        set.status = 201
        return { team }
      }),
  )
  .use(
    new Elysia()
      .use(
        orgRoleGuard([
          'owner',
          'admin',
          'head_coach',
          'assistant_coach',
          'coach',
          'analyst',
          'medical',
        ]),
      )
      .patch('/api/org/:auth0Id/teams/:teamId', async ({ params, request, body, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid team id', false)
        }
        const g = await guard(auth0Id, request, set, 'team.manage', teamId)
        if (!('caller' in g)) return g
        const { name } = (body ?? {}) as { name?: unknown }
        if (typeof name !== 'string' || !name.trim()) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'name is required', false)
        }
        const team = await renameTeam(auth0Id, teamId, name)
        if (!team) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        logTeamAudit(request, auth0Id, 'team.renamed', team.id, {
          name: team.name,
        })
        set.status = 200
        return { team }
      })
      .delete('/api/org/:auth0Id/teams/:teamId', async ({ params, request, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid team id', false)
        }
        // Deletion stays owner/admin-only even though coaches may rename
        // assigned teams: guard() enforces scope, this pins the role floor.
        const { role } = await resolveCaller(auth0Id, request)
        if (role !== 'owner' && role !== 'admin') return forbid(set)
        const removed = await deleteTeam(auth0Id, teamId)
        if (!removed) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        logTeamAudit(request, auth0Id, 'team.deleted', teamId)
        set.status = 200
        return { deleted: true }
      })
      .get('/api/org/:auth0Id/teams/:teamId/members', async ({ params, request, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid team id', false)
        }
        const g = await guard(auth0Id, request, set, 'team.read', teamId)
        if (!('caller' in g)) return g
        if (!(await getTeam(auth0Id, teamId))) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        set.status = 200
        return { members: await listTeamMembers(teamId) }
      })
      .post('/api/org/:auth0Id/teams/:teamId/members', async ({ params, request, body, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid team id', false)
        }
        const g = await guard(auth0Id, request, set, 'team.manage_members', teamId)
        if (!('caller' in g)) return g
        if (!(await getTeam(auth0Id, teamId))) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        const { member_auth0_id, student_id, role } = (body ?? {}) as {
          member_auth0_id?: unknown
          student_id?: unknown
          role?: unknown
        }
        if (
          (typeof member_auth0_id !== 'string' || !member_auth0_id.trim()) &&
          (typeof student_id !== 'string' || !UUID_RE.test(student_id))
        ) {
          set.status = 400
          return buildError(
            'INVALID_REQUEST',
            'member_auth0_id or a valid student_id is required',
            false,
          )
        }
        if (role !== undefined && role !== 'coach' && role !== 'player') {
          set.status = 400
          return buildError('INVALID_REQUEST', 'role must be coach or player', false)
        }
        // A student assignment writes BOTH halves: `students.team_id` (the
        // scope source of truth — a membership row alone leaves the player
        // invisible to the team's coaches) and the mirrored membership row
        // (without it the player is missing from the team roster).
        if (typeof student_id === 'string' && UUID_RE.test(student_id)) {
          const change = await setStudentTeam(auth0Id, student_id, teamId)
          if (!change || !change.member) {
            set.status = 404
            return buildError('NOT_FOUND', 'Student not found in this organization', false)
          }
          logTeamAudit(request, auth0Id, 'team.member_added', teamId, {
            membership: change.member.id,
          })
          if (change.fromTeamId && change.fromTeamId !== teamId) {
            auditRoute(request, auth0Id, 'player.transferred', 'student', student_id, {
              from_team: change.fromTeamId,
              to_team: teamId,
            })
          }
          set.status = 201
          return { member: change.member }
        }
        const member = await addTeamMember(teamId, {
          memberAuth0Id: typeof member_auth0_id === 'string' ? member_auth0_id : null,
          studentId: null,
          role: role === 'coach' ? 'coach' : 'player',
        })
        if (!member) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Could not add team member', false)
        }
        logTeamAudit(request, auth0Id, 'team.member_added', teamId, {
          membership: member.id,
        })
        set.status = 201
        return { member }
      })
      .delete(
        '/api/org/:auth0Id/teams/:teamId/members/:membershipId',
        async ({ params, request, set }) => {
          const { auth0Id, teamId, membershipId } = params
          if (
            !auth0Id ||
            !teamId ||
            !UUID_RE.test(teamId) ||
            !membershipId ||
            !UUID_RE.test(membershipId)
          ) {
            set.status = 400
            return buildError('INVALID_REQUEST', 'Invalid team or membership id', false)
          }
          const g = await guard(auth0Id, request, set, 'team.manage_members', teamId)
          if (!('caller' in g)) return g
          // A student removal clears `students.team_id` as well as the row:
          // deleting the membership alone would strand the player on a team
          // whose roster no longer lists them but whose scope still does.
          const membership = await getTeamMembership(teamId, membershipId)
          if (membership?.student_id) {
            const change = await setStudentTeam(auth0Id, membership.student_id, null)
            if (change) {
              logTeamAudit(request, auth0Id, 'team.member_removed', teamId, {
                membership: membershipId,
              })
              set.status = 200
              return { deleted: true }
            }
            // The student row is gone but its membership row survived: drop
            // the orphan so the roster cannot wedge.
          }
          const removed = await removeTeamMember(teamId, membershipId)
          if (!removed) {
            set.status = 404
            return buildError('NOT_FOUND', 'Team member not found', false)
          }
          logTeamAudit(request, auth0Id, 'team.member_removed', teamId, {
            membership: membershipId,
          })
          set.status = 200
          return { deleted: true }
        },
      ),
  )
