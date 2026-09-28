import {
  createScheduleEvent,
  deleteScheduleEvent,
  getScheduleEvent,
  listSchedule,
  updateScheduleEvent,
} from '../../lib/orgData'
import { isIsoDate } from '../../lib/orgValidate'
import { UUID_RE } from '../../lib/uuid'
import { resolveCaller, type Caller } from '../../lib/caller'
import { EVENT_STATUS_SET, EVENT_TYPE_SET, parseScheduleInput, resolveTeamId } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

const TEAM_SCOPE_MESSAGE = 'Managing the schedule is limited to the teams in your scope'

/**
 * The team dimension of a schedule write, the same rule `listSchedule` reads
 * with. An event with a team belongs to that team, so a scoped caller may only
 * touch its own; an event with NO team is club-level — org-wide by definition —
 * so creating, editing or deleting one is org staff's alone. Without that second
 * half any team coach could publish to the whole club by omitting `team_id`.
 *
 * `attendance.write` is a capability, not a scope: it says a role may run
 * sessions, not whose calendar it may reshape.
 */
const eventTeamWritable = (caller: Caller, teamId: string | null): boolean => {
  if (teamId === null) return caller.studentScope.all
  return caller.canAccessTeam(teamId)
}

export default new Elysia()
  .use(serviceGuard)
  // ── Schedule ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/schedule', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const caller = await resolveCaller(auth0Id, request)
    set.status = 200
    return {
      events: await listSchedule(auth0Id, {
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        // A team coach sees their own fixtures plus the club-wide ones; org staff
        // see every event.
        teamIds: caller.studentScope.all ? undefined : caller.studentScope.teamIds,
      }),
    }
  })
  .post('/api/org/:auth0Id/schedule', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    // Scheduling is the same "run the session" job as attendance, so it shares
    // the attendance.write capability.
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Managing the schedule requires the attendance.write permission',
        false,
      )
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const input = parseScheduleInput(raw)
    if (!input.title || typeof input.title !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: title', false)
    }
    if (!input.starts_at || !isIsoDate(input.starts_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_at must be a valid ISO datetime', false)
    }
    if (input.event_type !== undefined && !EVENT_TYPE_SET.has(input.event_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `event_type must be one of ${[...EVENT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (input.status !== undefined && !EVENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...EVENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (input.ends_at !== undefined && input.ends_at !== null && !isIsoDate(input.ends_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'ends_at must be a valid ISO datetime', false)
    }
    // The team must exist in this org (400), and then be one the caller can
    // reach (403). A scoped caller that omits `team_id` is asking for the
    // club-wide calendar, which only org staff may publish to.
    const team = await resolveTeamId(auth0Id, raw.team_id)
    if (!team.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', team.error, false)
    }
    if (!eventTeamWritable(caller, team.teamId)) {
      set.status = 403
      return buildError('FORBIDDEN', TEAM_SCOPE_MESSAGE, false)
    }
    if (team.teamId) input.team_id = team.teamId

    const event = await createScheduleEvent(auth0Id, input)
    if (!event) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create schedule event', true)
    }
    set.status = 201
    return { event }
  })
  .put('/api/org/:auth0Id/schedule/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid event id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Managing the schedule requires the attendance.write permission',
        false,
      )
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const input = parseScheduleInput(raw)
    if (input.starts_at !== undefined && typeof input.starts_at !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'starts_at must be a valid ISO datetime', false)
    }
    if (input.event_type !== undefined && !EVENT_TYPE_SET.has(input.event_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `event_type must be one of ${[...EVENT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (input.status !== undefined && !EVENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...EVENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    // Fetch-then-check: a load with no narrowing, so "missing" (404) stays
    // distinct from "not yours" (403), and the refusal lands before any write.
    const existing = await getScheduleEvent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    if (!eventTeamWritable(caller, existing.team_id)) {
      set.status = 403
      return buildError('FORBIDDEN', TEAM_SCOPE_MESSAGE, false)
    }
    // Reassigning is a write like any other: the new team must be in the org
    // (400) and reachable (403), so a scoped caller cannot promote its event to
    // the club calendar or hand it to another team.
    if ('team_id' in raw) {
      const team = await resolveTeamId(auth0Id, raw.team_id)
      if (!team.ok) {
        set.status = 400
        return buildError('INVALID_REQUEST', team.error, false)
      }
      if (!eventTeamWritable(caller, team.teamId)) {
        set.status = 403
        return buildError('FORBIDDEN', TEAM_SCOPE_MESSAGE, false)
      }
      input.team_id = team.teamId
    }

    const event = await updateScheduleEvent(auth0Id, id, input)
    if (!event) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    set.status = 200
    return { event }
  })
  .delete('/api/org/:auth0Id/schedule/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid event id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Managing the schedule requires the attendance.write permission',
        false,
      )
    }
    // Same fetch-then-check as the update: the event's own team decides, and the
    // club-wide calendar is an org-staff affair.
    const existing = await getScheduleEvent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    if (!eventTeamWritable(caller, existing.team_id)) {
      set.status = 403
      return buildError('FORBIDDEN', TEAM_SCOPE_MESSAGE, false)
    }
    const deleted = await deleteScheduleEvent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
