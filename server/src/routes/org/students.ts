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
  readListLimit,
  validateStudentRow,
  type ImportRow,
} from '../../lib/orgValidate'
import { linkAnalysisToStudent } from '../../lib/analyses'
import { consentForStudent, gateConsentWrite } from '../../lib/consents'
import { setStudentTeam } from '../../lib/teams'
import { resolveCaller } from '../../lib/caller'
import { accountJobScope } from '../../lib/accountScope'
import { hasPermission, redactWellness, resolveMedicalAccess } from '../../lib/permissions'
import { auditRoute } from '../../lib/audit'
import { STUDENT_STATUS_SET, parseStudentInput, resolveTeamId, studentScope } from './shared'
import { canSeeStudent, visibleStudentIds } from '../../lib/org/scope'
import { UUID_RE, pickUuid } from '../../lib/uuid'
import { buildError } from '../../lib/errors'
import { serviceGuard, SERVICE_HEADERS } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

/**
 * Visibility test for student-keyed handlers. Scoped callers are refused
 * before any store call: reads answer 404, matching the roster read below, so
 * a hidden student is indistinguishable from one that does not exist. Writes
 * answer 403, beside the capability gate they follow.
 */
const studentVisible = async (
  auth0Id: string,
  request: Request,
  studentId: string,
): Promise<boolean> => {
  const scope = (await resolveCaller(auth0Id, request)).studentScope
  if (scope.all) return true
  return canSeeStudent(await visibleStudentIds(auth0Id, scope), studentId)
}

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
      includeArchived: url.searchParams.get('include_archived') === '1',
      ...(scope.all ? {} : { teamIds: scope.teamIds }),
      // Never null: `listStudents` reads an absent limit as unlimited, and no web
      // caller ever sent one. The export bounds itself by calling the data layer.
      limit: readListLimit(url),
    })
    set.status = 200
    return { students }
  })
  .get('/api/org/:auth0Id/students/sports', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    // An AGGREGATE over the roster, so it answers the same question the roster
    // list above does. This one did not ask it at all: it was a distinct-sport
    // read over every row in the org, so a team-A coach's sport filter listed
    // sports that only team B fields — the one read on this tree that shipped
    // another team's roster shape to a scoped caller. The filter is the same
    // `teamIds` filter `listStudents` already takes, narrowed in SQL rather than
    // by filtering the org-wide answer in the route: the ids never leave.
    const scope = await studentScope(auth0Id, request)
    const sports = await listStudentSports(auth0Id, {
      ...(scope.all ? {} : { teamIds: scope.teamIds }),
    })
    set.status = 200
    return { sports }
  })
  .get('/api/org/:auth0Id/students/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    // A malformed id is a client error. It used to reach `getStudent`'s ::uuid
    // cast, raise 22P02, and surface as 500 INTERNAL_ERROR — the same route
    // answers a clean 400 for a *missing* id, so the two were indistinguishable
    // from the outside while meaning very different things.
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
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
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Creating students requires the player.manage permission',
        false,
      )
    }
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
      // Scoped staff can only file a player under a team they belong to.
      //
      // `resolveTeamId` answers an ORG question — it stops a coach from linking a
      // player to a team in another organization — and its own doc comment says
      // so. It never asked the SCOPE question, and the sibling PUT route in this
      // file did ask it; create did not. So `player.manage` plus a valid
      // cross-org-safe team uuid was enough to file a new player onto a team the
      // caller is not assigned to — a write outside the roster scope that
      // `resolveStudentScope` is supposed to make impossible, and one that is
      // invisible to the coach's own view.
      const scope = await studentScope(auth0Id, request)
      if (!scope.all && !scope.teamIds.includes(team.teamId)) {
        set.status = 403
        return buildError('FORBIDDEN', 'Cannot assign a team outside your scope', false)
      }
      input.team_id = team.teamId
    } else {
      // Hierarchy convenience: a coach with exactly one team creates
      // players under that team unless another is chosen.
      const role = caller.role
      if (
        role === 'head_coach' ||
        role === 'assistant_coach' ||
        role === 'coach' ||
        role === 'analyst' ||
        role === 'medical'
      ) {
        if (caller.teamIds.length === 1) input.team_id = caller.teamIds[0]
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
    // A malformed id is a client error. It used to reach `getStudent`'s ::uuid
    // cast, raise 22P02, and surface as 500 INTERNAL_ERROR — the same route
    // answers a clean 400 for a *missing* id, so the two were indistinguishable
    // from the outside while meaning very different things.
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Updating students requires the player.manage permission',
        false,
      )
    }
    const existing = await getStudent(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    // Capability is not scope: a team coach may not reshape a roster they
    // cannot see.
    if (!(await studentVisible(auth0Id, request, id))) {
      set.status = 403
      return buildError('FORBIDDEN', 'Updating students requires access to that student', false)
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
    const assignTeam = 'team_id' in input
    const { team_id: nextTeam, ...scalarInput } = input

    const student = await updateStudent(auth0Id, id, scalarInput)
    if (!student) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    // The team move goes through the mirrored write: `students.team_id` plus
    // the `team_memberships` row, in one transaction. `resolveTeamId` above
    // already answered org and scope; this answers the mirror.
    let finalStudent = student
    let movedFrom: string | null | undefined
    if (assignTeam) {
      const change = await setStudentTeam(
        auth0Id,
        id,
        typeof nextTeam === 'string' ? nextTeam : null,
      )
      if (!change?.student) {
        set.status = 404
        return buildError('NOT_FOUND', 'Student not found', false)
      }
      finalStudent = { ...student, ...change.student }
      movedFrom = change.fromTeamId
    }
    if (existing.status !== 'transferred' && finalStudent.status === 'transferred') {
      auditRoute(request, auth0Id, 'player.transferred', 'student', id, {
        from_team: existing.team_id,
        to_team: finalStudent.team_id,
      })
    } else if (assignTeam && movedFrom !== finalStudent.team_id) {
      auditRoute(request, auth0Id, 'player.transferred', 'student', id, {
        from_team: movedFrom ?? null,
        to_team: finalStudent.team_id,
      })
    }
    set.status = 200
    return { student: finalStudent }
  })
  .delete('/api/org/:auth0Id/students/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    // A malformed id reaches a `::uuid` cast and raises 22P02, reported as a
    // 500 — the boundary is the only place that knows it is a 400.
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Deleting students requires the player.manage permission',
        false,
      )
    }
    if (!(await studentVisible(auth0Id, request, id))) {
      set.status = 403
      return buildError('FORBIDDEN', 'Deleting students requires access to that student', false)
    }
    // Capture the name before deleting: the audit row outlives the student.
    const existing = await getStudent(auth0Id, id)
    const deleted = await deleteStudent(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    auditRoute(request, auth0Id, 'player.deleted', 'student', id, {
      full_name: existing?.full_name ?? null,
    })
    set.status = 200
    return { deleted: true }
  })
  .post('/api/org/:auth0Id/students/import', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Importing students requires the player.manage permission',
        false,
      )
    }
    const { rows, team_id: batchTeamRaw } = body as { rows?: unknown[]; team_id?: unknown }
    if (!Array.isArray(rows) || rows.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'rows must be a non-empty array', false)
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      set.status = 400
      return buildError('INVALID_REQUEST', `Maximum ${MAX_IMPORT_ROWS} rows per import`, false)
    }

    // ── Team assignment ──────────────────────────────────────────────────────
    // This route used to have no team concept at all: `ImportRow` had no
    // `team_id` and `importStudents` inserts only the cleaned columns, so EVERY
    // imported player landed with `team_id = NULL`. Two consequences, and only
    // one of them is a security problem:
    //   1. `player.manage` plus this route was a way to create players with no
    //      scope check whatsoever — a bypass of the roster scope, which the
    //      single-student POST now refuses (see its `studentScope` gate).
    //   2. Even for the owner it was a broken feature: a head coach who bulk
    //      imported a roster got 200 players they can never see, because a
    //      NULL-team student is outside a team-scoped caller's view.
    //
    // A row may name its own `team_id`; the request may carry one batch-level
    // `team_id` as the default. Malformed/unknown ids are DATA errors and join
    // the per-row `failed` list like every other bad field. A team that resolves
    // but sits outside the caller's scope is an AUTHORIZATION failure and
    // refuses the whole request — "you may not write here" is not a per-row
    // opinion, and a 200 with some rows silently dropped would be worse.
    const batchTeam = await resolveTeamId(auth0Id, batchTeamRaw)
    if (!batchTeam.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', batchTeam.error, false)
    }
    const scope = await studentScope(auth0Id, request)
    // Same hierarchy convenience as POST /students: a scoped caller with exactly
    // one team files under it, so the common case needs no team in the CSV.
    const onlyTeam = !scope.all && scope.teamIds.length === 1 ? scope.teamIds[0] : null

    const validated: Array<{ cleaned: Record<string, unknown> }> = []
    const failed: Array<{ row_index: number; reason: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ImportRow
      const result = validateStudentRow(row)
      if (!result.ok) {
        failed.push({ row_index: i, reason: result.reason })
        continue
      }
      const cleaned = { ...result.cleaned }
      const rawTeam = cleaned.team_id ?? batchTeam.teamId
      const resolved =
        rawTeam === undefined || rawTeam === null || rawTeam === ''
          ? { ok: true as const, teamId: null }
          : await resolveTeamId(auth0Id, rawTeam)
      if (!resolved.ok) {
        failed.push({ row_index: i, reason: resolved.error })
        continue
      }
      let teamId = resolved.teamId
      if (!scope.all) {
        if (teamId && !scope.teamIds.includes(teamId)) {
          set.status = 403
          return buildError(
            'FORBIDDEN',
            'Cannot import players into a team outside your scope',
            false,
          )
        }
        if (!teamId) {
          // No team named and none inferable: refuse rather than write players
          // the caller is not allowed to see. Only a multi-team (or teamless)
          // scoped caller lands here; a single-team one was defaulted above.
          if (onlyTeam) {
            teamId = onlyTeam
          } else {
            set.status = 403
            return buildError(
              'FORBIDDEN',
              'A team_id is required: you are not assigned to exactly one team',
              false,
            )
          }
        }
      }
      if (teamId) {
        cleaned.team_id = teamId
      } else {
        delete cleaned.team_id
      }
      validated.push({ cleaned })
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
    // A malformed id is a client error. It used to reach `getStudent`'s ::uuid
    // cast, raise 22P02, and surface as 500 INTERNAL_ERROR — the same route
    // answers a clean 400 for a *missing* id, so the two were indistinguishable
    // from the outside while meaning very different things.
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    if (!(await studentVisible(auth0Id, request, id))) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    const url = new URL(request.url)
    const rawFrom = url.searchParams.get('from')
    const rawTo = url.searchParams.get('to')
    if ((rawFrom !== null && !isIsoDate(rawFrom)) || (rawTo !== null && !isIsoDate(rawTo))) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid series filter', false)
    }
    const series = await getStudentPerformanceSeries(auth0Id, id, {
      metricKey: url.searchParams.get('metricKey') ?? undefined,
      from: rawFrom ?? undefined,
      to: rawTo ?? undefined,
    })
    set.status = 200
    return { series }
  })
  .post('/api/org/:auth0Id/students/:id/performance', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Recording performance metrics requires the player.manage permission',
        false,
      )
    }
    if (!(await studentVisible(auth0Id, request, id))) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Recording performance metrics requires access to that student',
        false,
      )
    }
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
  .get('/api/org/:auth0Id/students/:id/analyses', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    // A malformed id is a client error. It used to reach `getStudent`'s ::uuid
    // cast, raise 22P02, and surface as 500 INTERNAL_ERROR — the same route
    // answers a clean 400 for a *missing* id, so the two were indistinguishable
    // from the outside while meaning very different things.
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    if (!(await studentVisible(auth0Id, request, id))) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    // Wellness signals stay behind the medical boundary (§5). This route is the
    // LIST twin of `GET /api/auth/user/:auth0Id/analyses/:jobId`, which asks
    // `resolveMedicalAccess` and redacts for everyone else — this one returned
    // `getStudentAnalyses(...)` verbatim, so any caller who could see the player
    // also received `summary_json.shot_events[].injury_risk`,
    // `weighted_scoring` and `biomechanics`.
    //
    // The check is explicit here rather than inherited from the list projection
    // (`ANALYSES_LIST_COLUMNS` ships `form_score` only today, which narrows what
    // a list can leak): a projection is a perf decision that can be revisited,
    // and this route must be the thing that enforces the boundary if it is. It
    // also stays correct when it is — `redactWellness` on `{form_score: n}` is a
    // no-op, so the entitled caller loses nothing either way.
    //
    // Same rule as the twin, deliberately not a new one: the owning account (the
    // `:auth0Id` in the path, whose analyses these rows are), or a member whose
    // org role is `owner` or `medical`. `admin` holds every permission *except*
    // `medical.read` (ROLE_PERMISSIONS), so it is redacted here too.
    const maySee = await resolveMedicalAccess(
      auth0Id,
      request.headers.get(SERVICE_HEADERS.verifiedAuth0Id),
    )
    const analyses = await getStudentAnalyses(auth0Id, id)
    set.status = 200
    return {
      analyses: maySee
        ? analyses
        : analyses.map((a) => ({ ...a, summary_json: redactWellness(a.summary_json) })),
    }
  })
  .put('/api/org/:auth0Id/analyses/:jobId/student', async ({ params, body, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const role = caller.role
    if (!hasPermission(role, 'player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Linking analyses to students requires player.manage', false)
    }
    // Narrow once, then use the narrowed value everywhere. A string was accepted
    // on shape alone, so "not-a-uuid" passed the old `typeof === 'string'` check
    // and then raised 22P02 inside getStudent's ::uuid cast — a 500 for what is a
    // malformed request. Absent or null still means "unlink" and stays allowed.
    const rawStudentId = (body as { student_id?: unknown }).student_id
    const studentId =
      rawStudentId === undefined || rawStudentId === null ? null : pickUuid(rawStudentId)
    if (studentId === null && rawStudentId !== undefined && rawStudentId !== null) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a uuid or null', false)
    }
    if (studentId && (await getStudent(auth0Id, studentId)) === null) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    if (studentId !== null && !(await studentVisible(auth0Id, request, studentId))) {
      set.status = 403
      return buildError('FORBIDDEN', 'Linking analyses requires access to that student', false)
    }
    // The scope check above is on the *target* student, so it is skipped
    // entirely when the body omits student_id — which is the unlink case, and
    // the one that reached the store unguarded. `linkAnalysisToStudent` filters
    // on server_job_id + auth0_id, i.e. org-scoped but not roster-scoped, so a
    // team-A coach could unlink team B's player from their own analysis by
    // sending {}. The job itself is now checked through the account-tree seam:
    // a write, so an out-of-scope target is a 403 beside the capability gate.
    const jobScope = await accountJobScope(auth0Id, jobId, request, 'write', caller)
    if (!jobScope.ok) {
      set.status = jobScope.status
      return jobScope.error
    }
    // Linking builds training data about the player: without their
    // training-data consent this logs + audits (warn) or refuses (enforce).
    // Unlinking (null) needs no consent.
    if (studentId) {
      const gate = await gateConsentWrite({
        request,
        orgAuth0Id: auth0Id,
        studentId,
        granted: (await consentForStudent(studentId)).trainingData,
        purpose: 'trainingData',
        action: 'analysis.link',
      })
      if (!gate.ok) {
        set.status = gate.status
        return gate.error
      }
    }
    const analysis = await linkAnalysisToStudent(auth0Id, jobId, studentId)
    if (!analysis) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    // `linkAnalysisToStudent` is `update ... returning *`, so the row handed
    // back carries summary_json verbatim. This route's account-tree twin
    // (routes/auth.ts) strips the wellness signals for a caller without medical
    // access; this one did not, so the §5 boundary was enforced on the sibling
    // read and not here.
    const maySee = await resolveMedicalAccess(
      auth0Id,
      request.headers.get(SERVICE_HEADERS.verifiedAuth0Id),
    )
    set.status = 200
    return {
      analysis: maySee
        ? analysis
        : { ...analysis, summary_json: redactWellness(analysis.summary_json) },
    }
  })
