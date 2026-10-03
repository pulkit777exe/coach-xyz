import {
  createMatch,
  createSeason,
  deleteMatch,
  deleteSeason,
  getMatch,
  getSeason,
  listMatches,
  listSeasons,
} from '../../lib/orgData'
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
  .get('/api/org/:auth0Id/seasons', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    set.status = 200
    return {
      // A season is org-level metadata, so it is narrowed by the matches it
      // holds rather than hidden outright — see `listSeasons`.
      seasons: await listSeasons(auth0Id, {
        teamIds: caller.studentScope.all ? undefined : caller.studentScope.teamIds,
      }),
    }
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
    // A season carries no team_id: it belongs to the org, and `listSeasons`
    // deliberately keeps team-less rows org-visible (a season is hidden only
    // when it holds a match and none of them is the caller's). So the same
    // org-wide rule the match routes apply to a club-wide fixture applies here,
    // and it used to be missing entirely — `team.manage` alone let any
    // team-scoped coach create one. Same rule as `eventTeamWritable`.
    if (!caller.studentScope.all) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires org-wide scope', false)
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
    // Same org-wide rule as the create path: a season is an org-level object, so
    // deleting one is an org-level write however it was reached.
    if (!caller.studentScope.all) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing seasons requires org-wide scope', false)
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
    const caller = await resolveCaller(auth0Id, request)
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    set.status = 200
    return {
      matches: await listMatches(auth0Id, {
        teamId: pickId(url.searchParams.get('team_id')),
        seasonId: pickId(url.searchParams.get('season_id')),
        // A team coach sees their own fixtures; org staff see every match.
        teamIds: caller.studentScope.all ? undefined : caller.studentScope.teamIds,
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
    // Same shape, same 400, one line down: `matches.season_id` is a loose link
    // (no foreign key), so a season uuid is globally unique and nothing in the
    // insert can tell org A's fixture from org B's. Validating `team_id` while
    // writing `season_id` unvalidated left a cross-tenant row that only the read
    // filter's `org_auth0_id` hid. `listSeasons` also matches on `season_id`, so
    // a foreign season would otherwise leak org B's season name into org A's
    // match list via the join.
    const seasonId = pickId(raw.season_id)
    if (seasonId && !(await getSeason(auth0Id, seasonId))) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'season not found in this organization', false)
    }
    // team.manage is a capability, not a scope: it says a role may manage
    // fixtures, not another team's — and not the CLUB's either. Omitting
    // `team_id` used to short-circuit this check entirely (`teamId && …`), so a
    // team-scoped coach could publish to everyone's calendar simply by leaving
    // it out. Same rule as `eventTeamWritable` in org/schedule.ts: a club-wide
    // row belongs to the org, so only an org-wide caller may author one. The
    // READ asymmetry is deliberate and unchanged — `listMatches` still shows
    // team-less fixtures to everyone.
    if (teamId ? !caller.canAccessTeam(teamId) : !caller.studentScope.all) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        teamId
          ? 'Managing matches requires access to that team'
          : 'Managing club-wide matches requires org-wide scope',
        false,
      )
    }
    const match = await createMatch(auth0Id, {
      team_id: teamId,
      season_id: seasonId,
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
    // Load the target before deleting so its team can be scope-checked; a
    // team coach must not remove another team's fixture by id.
    const target = await getMatch(auth0Id, id)
    if (!target) {
      set.status = 404
      return buildError('NOT_FOUND', 'Match not found', false)
    }
    // Same org-wide rule as the create path above, applied to the TARGET row
    // rather than to a submitted id: a team-less fixture is the club's, and
    // `target.team_id && …` let any team coach delete one by id.
    if (target.team_id ? !caller.canAccessTeam(target.team_id) : !caller.studentScope.all) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        target.team_id
          ? 'Managing matches requires access to that team'
          : 'Managing club-wide matches requires org-wide scope',
        false,
      )
    }
    const removed = await deleteMatch(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Match not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
