import {
  compareStudents,
  deletePerformanceMetric,
  getStudent,
  getStudentTrends,
  listPerformance,
  getPerformanceMetric,
  updatePerformanceMetric,
} from '../../lib/orgData'
import { canSeeStudent, visibleStudentIds } from '../../lib/org/scope'
import { DEFAULT_COMPARISON_METRIC_KEY } from '../../lib/orgValidate'
import { resolveCaller } from '../../lib/caller'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

/** Capability is not scope: `player.manage` says WHICH writes, not WHOSE. */
const OUT_OF_SCOPE_MESSAGE = 'Performance metrics are limited to the students in your team scope'

export default new Elysia()
  .use(serviceGuard)
  // ── Performance metrics (cross-student) ────────────────────────────────────
  .get('/api/org/:auth0Id/performance', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    if (!studentId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing studentId parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const metrics = await listPerformance(auth0Id, studentId, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      // An out-of-scope studentId matches no rows; `null` keeps org-wide callers
      // (owner/admin/analyst/medical) unnarrowed.
      studentIds: await visibleStudentIds(auth0Id, caller.studentScope),
    })
    set.status = 200
    return { metrics }
  })
  .delete('/api/org/:auth0Id/performance/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Deleting performance metrics requires the player.manage permission',
        false,
      )
    }
    // The route is keyed by metric id, so resolve the owning student first and
    // refuse before the delete when the caller cannot see that student.
    const metric = await getPerformanceMetric(auth0Id, id)
    if (!metric) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found', false)
    }
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, metric.student_id)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE_MESSAGE, false)
    }
    const deleted = await deletePerformanceMetric(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .put('/api/org/:auth0Id/performance/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Updating performance metrics requires the player.manage permission',
        false,
      )
    }
    const { metric_value, unit } = body as Record<string, unknown>
    if (typeof metric_value !== 'number' || !Number.isFinite(metric_value)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'metric_value must be a finite number', false)
    }
    const metric = await getPerformanceMetric(auth0Id, id)
    if (!metric) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found or is analysis-linked', false)
    }
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, metric.student_id)) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE_MESSAGE, false)
    }
    const updated = await updatePerformanceMetric(auth0Id, id, {
      metric_value: metric_value as number,
      unit: typeof unit === 'string' ? unit : null,
    })
    if (!updated) {
      set.status = 404
      return buildError('NOT_FOUND', 'Performance metric not found or is analysis-linked', false)
    }
    set.status = 200
    return { metric: updated }
  })
  // ── Student trends ────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students/:id/trends', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const url = new URL(request.url)
    // Single-student read: an out-of-scope id yields no series and no trends.
    const trends = await getStudentTrends(auth0Id, id, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      studentIds: await visibleStudentIds(auth0Id, caller.studentScope),
    })
    set.status = 200
    return { trends }
  })
  // ── Student comparison ────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students/comparison', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id', false)
    }
    const url = new URL(request.url)
    const idsParam = url.searchParams.get('ids')
    if (!idsParam) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing ids query parameter', false)
    }
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length === 0 || ids.length > 10) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Provide 1-10 student ids', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    // Drop invisible students BEFORE the lookup: a scoped caller must not learn
    // that an out-of-scope student exists through a named, empty comparison row.
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    const visible = ids.filter((id) => canSeeStudent(studentIds, id))
    const metricKey = url.searchParams.get('metricKey') ?? DEFAULT_COMPARISON_METRIC_KEY
    const comparison = await compareStudents(auth0Id, visible, metricKey)
    set.status = 200
    return { comparison }
  })
