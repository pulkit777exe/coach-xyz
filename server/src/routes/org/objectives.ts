import {
  createObjective,
  deleteObjective,
  listObjectives,
  setObjectiveStatus,
} from '../../lib/orgData'
import {
  isDate,
} from '../../lib/orgValidate'
import { resolveCaller } from '../../lib/caller'
import { hasPermission } from '../../lib/permissions'
import {
  UUID_RE,
} from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Training objectives (§26 loop) ───────────────────────────────────────
  .get('/api/org/:auth0Id/objectives', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    const objectives = await listObjectives(auth0Id, {
      studentId: pickId(url.searchParams.get('student_id')),
      teamId: pickId(url.searchParams.get('team_id')),
      status: url.searchParams.get('status'),
    })
    set.status = 200
    return { objectives }
  })
  .post('/api/org/:auth0Id/objectives', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    const title = typeof raw.title === 'string' ? raw.title : ''
    if (!title.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'title is required', false)
    }
    if (raw.due_on !== undefined && raw.due_on !== null && !isDate(raw.due_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'due_on must be YYYY-MM-DD', false)
    }
    const objective = await createObjective(auth0Id, caller.verified, {
      student_id: pickId(raw.student_id),
      team_id: pickId(raw.team_id),
      finding_id: typeof raw.finding_id === 'string' ? raw.finding_id : null,
      analysis_job_id: typeof raw.analysis_job_id === 'string' ? raw.analysis_job_id : null,
      title,
      description: typeof raw.description === 'string' ? raw.description : null,
      due_on: typeof raw.due_on === 'string' ? raw.due_on : null,
    })
    if (!objective) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        'Could not create objective (unknown student/team?)',
        false,
      )
    }
    set.status = 201
    return { objective }
  })
  .patch('/api/org/:auth0Id/objectives/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid objective id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const { status } = (body ?? {}) as { status?: unknown }
    if (status !== 'active' && status !== 'done' && status !== 'archived') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'status must be active, done, or archived', false)
    }
    const objective = await setObjectiveStatus(auth0Id, id, status)
    if (!objective) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    set.status = 200
    return { objective }
  })
  .delete('/api/org/:auth0Id/objectives/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid objective id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training objectives requires player.manage', false)
    }
    const removed = await deleteObjective(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
