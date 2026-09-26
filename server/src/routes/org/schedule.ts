import {
  createScheduleEvent,
  deleteScheduleEvent,
  listSchedule,
  updateScheduleEvent,
} from '../../lib/orgData'
import { isIsoDate } from '../../lib/orgValidate'
import { resolveCaller } from '../../lib/caller'
import { EVENT_STATUS_SET, EVENT_TYPE_SET, parseScheduleInput } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Schedule ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/schedule', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const events = await listSchedule(auth0Id, {
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { events }
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
    const input = parseScheduleInput(body as Record<string, unknown>)
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
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
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
    const input = parseScheduleInput(body as Record<string, unknown>)
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
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('attendance.write')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Managing the schedule requires the attendance.write permission',
        false,
      )
    }
    const deleted = await deleteScheduleEvent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Schedule event not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
