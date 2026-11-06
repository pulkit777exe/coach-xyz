import { Elysia } from 'elysia'

import { badRequest, buildError } from '../lib/errors'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  renameTeam,
} from '../lib/teams'
import { orgRoleGuard, serviceGuard } from '../lib/serviceGuard'
import { ORG_MEMBER_ROLES } from '../lib/orgMembers'
import { UUID_RE, auditOrg, forbidOrg } from '../lib/orgRoute'
import { type Permission } from '../lib/permissions'
import { resolveCaller, type Caller } from '../lib/caller'

/** Guard: membership + permission + (for team-scoped routes) team scope. */
const guard = async (
  orgAuth0Id: string,
  request: Request,
  set: { status?: number | string },
  permission: Permission,
  teamId?: string,
): Promise<{ caller: Caller } | ReturnType<typeof buildError>> => {
  const caller = await resolveCaller(orgAuth0Id, request)
  const decision = caller.decide(permission, { teamId: teamId ?? null })
  if (!decision.allow) return forbidOrg(set)
  return { caller }
}

// Team management routes. orgRoleGuard keeps every route member-scoped;
// in-handler permission + team-scope checks layer §4 semantics on top.
export default new Elysia()
  .use(serviceGuard)
  .use(
    new Elysia()
      .use(
        orgRoleGuard(ORG_MEMBER_ROLES),
      )
      .get('/api/org/:auth0Id/teams', async ({ params, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
        return badRequest(set, 'Missing auth0Id parameter')
      }
        const caller = await resolveCaller(auth0Id, request)
        if (!caller.can('team.read')) return forbidOrg(set)
        const all = await listTeams(auth0Id)
        if (caller.role === 'owner') {
          set.status = 200
          return { teams: all }
        }
        const mine = new Set(caller.teamIds)
        set.status = 200
        return { teams: all.filter((t) => mine.has(t.id)) }
      })
      .post('/api/org/:auth0Id/teams', async ({ params, request, body, set }) => {
        const { auth0Id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id) {
          return badRequest(set, 'Missing auth0Id parameter')
        }
        const g = await guard(auth0Id, request, set, 'team.create')
        if (!('caller' in g)) return g
        const { name, sport } = (body ?? {}) as {
          name?: unknown
          sport?: unknown
        }
        if (typeof name !== 'string' || !name.trim()) {
        return badRequest(set, 'name is required')
      }
      if (sport !== undefined && sport !== null && typeof sport !== 'string') {
        return badRequest(set, 'sport must be a string')
      }
        const team = await createTeam(auth0Id, {
          name,
          sport: typeof sport === 'string' ? sport : null,
        })
        if (!team) {
          return badRequest(set, 'Could not create team')
        }
        audit('team.created', 'team', team.id, {
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
          'head_coach',
          'junior_coach',
          'player',
        ]),
      )
      .get('/api/org/:auth0Id/teams/:teamId', async ({ params, request, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
        return badRequest(set, 'Invalid team id')
      }
        const g = await guard(auth0Id, request, set, 'team.read', teamId)
        if (!('caller' in g)) return g
        const team = await getTeam(auth0Id, teamId)
        if (!team) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        set.status = 200
        return { team }
      })
      .patch('/api/org/:auth0Id/teams/:teamId', async ({ params, request, body, set }) => {
        const { auth0Id, teamId } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
        return badRequest(set, 'Invalid team id')
      }
        const g = await guard(auth0Id, request, set, 'team.manage', teamId)
        if (!('caller' in g)) return g
        const { name } = (body ?? {}) as { name?: unknown }
        if (typeof name !== 'string' || !name.trim()) {
        return badRequest(set, 'name is required')
      }
        const team = await renameTeam(auth0Id, teamId, name)
        if (!team) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        audit('team.renamed', 'team', team.id, {
          name: team.name,
        })
        set.status = 200
        return { team }
      })
      .delete('/api/org/:auth0Id/teams/:teamId', async ({ params, request, set }) => {
        const { auth0Id, teamId } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
        return badRequest(set, 'Invalid team id')
      }
        // Deletion is an owner action; head coaches manage (not destroy) teams.
        const g = await guard(auth0Id, request, set, 'team.delete', teamId)
        if (!('caller' in g)) return g
        const removed = await deleteTeam(auth0Id, teamId)
        if (!removed) {
          set.status = 404
          return buildError('NOT_FOUND', 'Team not found', false)
        }
        audit('team.deleted', 'team', teamId)
        set.status = 200
        return { deleted: true }
      })
      .get('/api/org/:auth0Id/teams/:teamId/members', async ({ params, request, set }) => {
        const { auth0Id, teamId } = params
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
        return badRequest(set, 'Invalid team id')
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
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !teamId || !UUID_RE.test(teamId)) {
        return badRequest(set, 'Invalid team id')
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
        return badRequest(set, 'member_auth0_id or a valid student_id is required')
        }
        if (role !== undefined && role !== 'coach' && role !== 'player') {
        return badRequest(set, 'role must be coach or player')
        }
        const member = await addTeamMember(teamId, {
          memberAuth0Id: typeof member_auth0_id === 'string' ? member_auth0_id : null,
          studentId: typeof student_id === 'string' ? student_id : null,
          role: role === 'coach' ? 'coach' : 'player',
        })
        if (!member) {
        return badRequest(set, 'Could not add team member')
        }
        audit('team.member_added', 'team', teamId, {
          membership: member.id,
        })
        set.status = 201
        return { member }
      })
      .delete(
        '/api/org/:auth0Id/teams/:teamId/members/:membershipId',
        async ({ params, request, set }) => {
          const { auth0Id, teamId, membershipId } = params
          const audit = auditOrg(request, auth0Id)
          if (
            !auth0Id ||
            !teamId ||
            !UUID_RE.test(teamId) ||
            !membershipId ||
            !UUID_RE.test(membershipId)
          ) {
        return badRequest(set, 'Invalid team or membership id')
        }
          const g = await guard(auth0Id, request, set, 'team.manage_members', teamId)
          if (!('caller' in g)) return g
          const removed = await removeTeamMember(teamId, membershipId)
          if (!removed) {
            set.status = 404
            return buildError('NOT_FOUND', 'Team member not found', false)
          }
          audit('team.member_removed', 'team', teamId, {
            membership: membershipId,
          })
          set.status = 200
          return { deleted: true }
        },
      ),
  )
