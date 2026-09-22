import {
  createPerformanceMetric,
  createStudent,
  deleteStudent,
  getStudent,
  getStudentAnalyses,
  getStudentPerformanceSeries,
  importStudents,
  listStudentSports,
  listStudents,
  updateStudent,
} from '../../lib/orgData'
import {
  MAX_IMPORT_ROWS,
  isDate,
  isIsoDate,
  validateStudentRow,
  type ImportRow,
} from '../../lib/orgValidate'
import {
  linkAnalysisToStudent,
} from '../../lib/analyses'
import { resolveCaller } from '../../lib/caller'
import { auditRoute } from '../../lib/audit'
import {
  STUDENT_STATUS_SET,
  parseStudentInput,
  resolveTeamId,
  studentScope,
} from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Students ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/students', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const scope = await studentScope(auth0Id, request)
    const students = await listStudents(auth0Id, {
      search: url.searchParams.get('search') ?? '',
      sport: url.searchParams.get('sport') ?? '',
      status: url.searchParams.get('status') ?? '',
      teamId: url.searchParams.get('team_id') ?? '',
      ...(scope.all ? {} : { teamIds: scope.teamIds }),
    })
    set.status = 200
    return { students }
  })
  .get('/api/org/:auth0Id/students/sports', async ({ params, set }) => {
    const { auth0Id } = params
    const sports = await listStudentSports(auth0Id)
    set.status = 200
    return { sports }
  })
  .get('/api/org/:auth0Id/students/:id', async ({ params, request, set }) => {
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
    // Hierarchy: staff outside the student's team get 404 (not 403 — no
    // membership oracle for roster enumeration).
    const scope = await studentScope(auth0Id, request)
    if (!scope.all && !(student.team_id && scope.teamIds.includes(student.team_id))) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 200
    return { student }
  })
  .post('/api/org/:auth0Id/students', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const input = parseStudentInput(body as Record<string, unknown>)

    if (!input.full_name || typeof input.full_name !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: full_name', false)
    }
    if (input.status !== undefined && !STUDENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...STUDENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (input.jersey_number !== undefined && typeof input.jersey_number !== 'number') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'jersey_number must be a number', false)
    }
    if (input.date_of_birth !== undefined && !isDate(input.date_of_birth)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'date_of_birth must be YYYY-MM-DD', false)
    }
    if (input.joined_on !== undefined && !isDate(input.joined_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'joined_on must be YYYY-MM-DD', false)
    }
    const team = await resolveTeamId(auth0Id, (body as Record<string, unknown>).team_id)
    if (!team.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', team.error, false)
    }
    if (team.teamId) {
      input.team_id = team.teamId
    } else {
      // Hierarchy convenience: a coach with exactly one team creates
      // players under that team unless another is chosen.
      const auto = await resolveCaller(auth0Id, request)
      if (auto.role === 'coach' || auto.role === 'analyst' || auto.role === 'medical') {
        if (auto.teamIds.length === 1) input.team_id = auto.teamIds[0]
      }
    }

    const student = await createStudent(auth0Id, input)
    if (!student) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create student', true)
    }
    auditRoute(request, auth0Id, 'player.created', 'student', student.id, {
      full_name: student.full_name,
    })
    set.status = 201
    return { student }
  })
  .put('/api/org/:auth0Id/students/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const existing = await getStudent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }

    const input = parseStudentInput(body as Record<string, unknown>)
    if (input.full_name !== undefined && typeof input.full_name !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'full_name must be a string', false)
    }
    if (input.status !== undefined && !STUDENT_STATUS_SET.has(input.status as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${[...STUDENT_STATUS_SET].join(', ')}`,
        false,
      )
    }
    if (
      input.jersey_number !== undefined &&
      input.jersey_number !== null &&
      typeof input.jersey_number !== 'number'
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'jersey_number must be a number', false)
    }
    if (
      input.date_of_birth !== undefined &&
      input.date_of_birth !== null &&
      !isDate(input.date_of_birth)
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'date_of_birth must be YYYY-MM-DD', false)
    }
    if (input.joined_on !== undefined && input.joined_on !== null && !isDate(input.joined_on)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'joined_on must be YYYY-MM-DD', false)
    }
    if ('team_id' in (body as Record<string, unknown>)) {
      const team = await resolveTeamId(auth0Id, (body as Record<string, unknown>).team_id)
      if (!team.ok) {
        set.status = 400
        return buildError('INVALID_REQUEST', team.error, false)
      }
      // Scoped staff can only assign teams they belong to.
      const scope = await studentScope(auth0Id, request)
      if (!scope.all && team.teamId && !scope.teamIds.includes(team.teamId)) {
        set.status = 403
        return buildError('FORBIDDEN', 'Cannot assign a team outside your scope', false)
      }
      input.team_id = team.teamId
    }

    const student = await updateStudent(auth0Id, id, input)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    if (existing.status !== 'transferred' && student.status === 'transferred') {
      auditRoute(request, auth0Id, 'player.transferred', 'student', id, {
        from_team: existing.team_id,
        to_team: student.team_id,
      })
    }
    set.status = 200
    return { student }
  })
  .delete('/api/org/:auth0Id/students/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteStudent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
  .post('/api/org/:auth0Id/students/import', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { rows } = body as { rows?: unknown[] }
    if (!Array.isArray(rows) || rows.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'rows must be a non-empty array', false)
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      set.status = 400
      return buildError('INVALID_REQUEST', `Maximum ${MAX_IMPORT_ROWS} rows per import`, false)
    }

    const validated: Array<{ cleaned: Record<string, unknown> }> = []
    const failed: Array<{ row_index: number; reason: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ImportRow
      const result = validateStudentRow(row)
      if (result.ok) {
        validated.push({ cleaned: result.cleaned })
      } else {
        failed.push({ row_index: i, reason: result.reason })
      }
    }

    if (validated.length === 0) {
      set.status = 400
      return { imported: 0, failed, duplicates_skipped: 0 }
    }

    const importResult = await importStudents(auth0Id, validated)
    // Merge pre-validation failures with data-layer failures
    importResult.failed = [...failed, ...importResult.failed]

    set.status = 200
    return {
      imported: importResult.imported,
      failed: importResult.failed,
      duplicates_skipped: importResult.duplicates_skipped,
    }
  })
  // ── Student detail: attendance, performance, analyses ─────────────────────
  .get('/api/org/:auth0Id/students/:id/performance', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    const url = new URL(request.url)
    const series = await getStudentPerformanceSeries(auth0Id, id, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    set.status = 200
    return { series }
  })
  .post('/api/org/:auth0Id/students/:id/performance', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const { metric_key, metric_value, unit, measured_at } = body as Record<string, unknown>
    if (!metric_key || typeof metric_key !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required field: metric_key', false)
    }
    if (typeof metric_value !== 'number' || !Number.isFinite(metric_value)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'metric_value must be a finite number', false)
    }
    if (measured_at !== undefined && !isIsoDate(measured_at)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'measured_at must be a valid ISO datetime', false)
    }
    const student = await getStudent(auth0Id, id)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found in this organization', false)
    }
    const metric = await createPerformanceMetric(auth0Id, {
      student_id: id,
      metric_key: metric_key as string,
      metric_value: metric_value as number,
      unit: typeof unit === 'string' ? unit : null,
      measured_at: typeof measured_at === 'string' ? measured_at : null,
    })
    if (!metric) {
      set.status = 409
      return buildError(
        'ALREADY_EXISTS',
        'A metric for this key already exists at that timestamp',
        false,
      )
    }
    set.status = 201
    return { metric }
  })
  .get('/api/org/:auth0Id/students/:id/analyses', async ({ params, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const analyses = await getStudentAnalyses(auth0Id, id)
    set.status = 200
    return { analyses }
  })
  .put('/api/org/:auth0Id/analyses/:jobId/student', async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const { student_id } = body as { student_id?: unknown }
    if (student_id !== undefined && student_id !== null && typeof student_id !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a string or null', false)
    }
    if (student_id && (await getStudent(auth0Id, student_id)) === null) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    const analysis = await linkAnalysisToStudent(
      auth0Id,
      jobId,
      (student_id as string | null) ?? null,
    )
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    set.status = 200
    return { analysis }
  })
