import {
  createMatch,
  createSeason,
  deleteMatch,
  deleteSeason,
  listMatches,
  listSeasons,
} from '../../lib/orgRoster'
import { isDate } from '../../lib/orgValidate'
import { getTeam } from '../../lib/teams'
import { resolveCaller } from '../../lib/caller'
import { hasPermission } from '../../lib/permissions'
import { UUID_RE } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Seasons & matches ────────────────────────────────────────────────
  .get('/api/org/:auth0Id/seasons', async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    set.status = 200
    return { seasons: await listSeasons(auth0Id) }
  })
  .post('/api/org/:auth0Id/seasons', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires team.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    if (raw.starts_on !== undefined && raw.starts_on !== null && !isDate(raw.starts_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_on must be YYYY-MM-DD', false)
    }
    if (raw.ends_on !== undefined && raw.ends_on !== null && !isDate(raw.ends_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'ends_on must be YYYY-MM-DD', false)
    }
    const season = await createSeason(auth0Id, {
      name: typeof raw.name === 'string' ? raw.name : '',
      starts_on: typeof raw.starts_on === 'string' ? raw.starts_on : null,
      ends_on: typeof raw.ends_on === 'string' ? raw.ends_on : null,
    })
    if (!season) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'name is required', false)
    }
    set.status = 201
    return { season }
  })
  .delete('/api/org/:auth0Id/seasons/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid season id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires team.manage', false)
    }
    const removed = await deleteSeason(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Season not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .get('/api/org/:auth0Id/matches', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    set.status = 200
    return {
      matches: await listMatches(auth0Id, {
        teamId: pickId(url.searchParams.get('team_id')),
        seasonId: pickId(url.searchParams.get('season_id')),
      }),
    }
  })
  .post('/api/org/:auth0Id/matches', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing matches requires team.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    if (raw.match_on !== undefined && raw.match_on !== null && !isDate(raw.match_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'match_on must be YYYY-MM-DD', false)
    }
    const teamId = pickId(raw.team_id)
    if (teamId && !(await getTeam(auth0Id, teamId))) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'team not found in this organization', false)
    }
    const match = await createMatch(auth0Id, {
      team_id: teamId,
      season_id: pickId(raw.season_id),
      opponent: typeof raw.opponent === 'string' ? raw.opponent : null,
      match_on: typeof raw.match_on === 'string' ? raw.match_on : null,
      location: typeof raw.location === 'string' ? raw.location : null,
      result: typeof raw.result === 'string' ? raw.result : null,
    })
    if (!match) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Could not create match', true)
    }
    set.status = 201
    return { match }
  })
  .delete('/api/org/:auth0Id/matches/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid match id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'team.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing matches requires team.manage', false)
    }
    const removed = await deleteMatch(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Match not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
