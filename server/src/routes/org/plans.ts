import {
  createTrainingPlan,
  deleteTrainingPlan,
  listTrainingPlans,
  setTrainingPlanStatus,
} from '../../lib/orgData'
import { resolveCaller } from '../../lib/caller'
import { hasPermission } from '../../lib/permissions'
import { UUID_RE } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Training plans ───────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/plans', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const pickId = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
    set.status = 200
    return {
      plans: await listTrainingPlans(auth0Id, {
        teamId: pickId(url.searchParams.get('team_id')),
        studentId: pickId(url.searchParams.get('student_id')),
      }),
    }
  })
  .post('/api/org/:auth0Id/plans', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const pickId = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null)
    const title = typeof raw.title === 'string' ? raw.title : ''
    if (!title.trim()) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'title is required', false)
    }
    const plan = await createTrainingPlan(auth0Id, caller.verified, {
      team_id: pickId(raw.team_id),
      student_id: pickId(raw.student_id),
      title,
      description: typeof raw.description === 'string' ? raw.description : null,
    })
    if (!plan) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Could not create plan (unknown student/team?)', false)
    }
    set.status = 201
    return { plan }
  })
  .patch('/api/org/:auth0Id/plans/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid plan id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const { status } = (body ?? {}) as { status?: unknown }
    if (status !== 'active' && status !== 'done' && status !== 'archived') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'status must be active, done, or archived', false)
    }
    const plan = await setTrainingPlanStatus(auth0Id, id, status)
    if (!plan) {
      set.status = 404
      return buildError('NOT_FOUND', 'Plan not found', false)
    }
    set.status = 200
    return { plan }
  })
  .delete('/api/org/:auth0Id/plans/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid plan id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Managing training plans requires player.manage', false)
    }
    const removed = await deleteTrainingPlan(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Plan not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
