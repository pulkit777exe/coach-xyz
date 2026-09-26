import {
  getObjective,
  createObjective,
  deleteObjective,
  listObjectives,
  setObjectiveStatus,
} from '../../lib/orgData'
import { isDate } from '../../lib/orgValidate'
import { resolveCaller } from '../../lib/caller'
import { hasPermission } from '../../lib/permissions'
import { visibleStudentIds } from '../../lib/org/scope'
// The pure visibility predicate is route logic rather than a data accessor, so
// it stays with its query; the read itself comes from the barrel.
import { objectiveVisibleTo } from '../../lib/org/objectives'
import { UUID_RE } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

const OUT_OF_SCOPE = 'Training objectives are limited to students and teams in your scope'

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
    const caller = await resolveCaller(auth0Id, request)
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const objectives = await listObjectives(auth0Id, {
      studentId: pickId(url.searchParams.get('student_id')),
      teamId: pickId(url.searchParams.get('team_id')),
      status: url.searchParams.get('status'),
      // Absent for an org-wide caller, so the query keeps the existing
      // team_id/student_id/status filters and nothing else.
      ...(caller.studentScope.all
        ? {}
        : { scope: { teamIds: caller.studentScope.teamIds, studentIds: visible ?? [] } }),
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
    // Scope gate, beside the capability gate and ahead of the insert: the
    // requested team OR student must be one the caller can reach. Neither set
    // is an org-level objective, which a scoped caller may not create.
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const target = { team_id: pickId(raw.team_id), student_id: pickId(raw.student_id) }
    if (!objectiveVisibleTo(caller.studentScope, visible, target)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
    }
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
      student_id: target.student_id,
      team_id: target.team_id,
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
    // Fetch-then-check: unscoped read so "missing" (404) stays distinct from
    // "not yours" (403), then refuse before the status update is attempted.
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const existing = await getObjective(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    if (!objectiveVisibleTo(caller.studentScope, visible, existing)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
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
    // Fetch-then-check, before the delete — see the PATCH handler.
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const existing = await getObjective(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    if (!objectiveVisibleTo(caller.studentScope, visible, existing)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
    }
    const removed = await deleteObjective(auth0Id, id)
    if (!removed) {
      set.status = 404
      return buildError('NOT_FOUND', 'Objective not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
