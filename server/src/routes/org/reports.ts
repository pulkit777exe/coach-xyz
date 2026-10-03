import {
  buildReportContent,
  createReportRecord,
  deleteReport,
  getReport,
  getStudent,
  listReports,
  updateReportRecord,
} from '../../lib/orgData'
import { defaultReportTitle, isDate, isIsoDate, readListLimit } from '../../lib/orgValidate'
import { REPORT_TYPE_SET } from './shared'
import type { ReportType } from '../../lib/orgEnums'
import { resolveCaller } from '../../lib/caller'
import { UUID_RE, pickUuid } from '../../lib/uuid'
import { canSeeStudent, visibleStudentIds } from '../../lib/org/scope'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { notifyReportReady } from '../../lib/notificationEvents'
import { logger } from '../../lib/logger'
import { Elysia } from 'elysia'

// A report belongs to exactly one student (reports carry no team_id), so scope
// is a pure student-visibility question. `report.create` says the caller may
// author reports at all; this says whose.
const OUT_OF_SCOPE = 'Reports are limited to students in your team scope'

export default new Elysia()
  .use(serviceGuard)
  // ── Reports ────────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/reports', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const caller = await resolveCaller(auth0Id, request)
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const rawStudentId = url.searchParams.get('studentId')
    if (rawStudentId !== null && !pickUuid(rawStudentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'studentId must be a uuid', false)
    }
    const reports = await listReports(auth0Id, {
      studentId: rawStudentId ?? undefined,
      // Absent for an org-wide caller (owner/admin/analyst/medical) so the query
      // stays unfiltered; present-and-empty for an unassigned coach.
      ...(visible === null ? {} : { visibleStudentIds: visible }),
      limit: readListLimit(url),
    })
    set.status = 200
    return { reports }
  })
  .get('/api/org/:auth0Id/reports/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid report id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    // Scoped in SQL, so a report outside the caller's scope reads as absent —
    // 404, not 403: a single-item read must not become an existence oracle.
    const report = await getReport(auth0Id, id, {
      ...(visible === null ? {} : { visibleStudentIds: visible }),
    })
    if (!report) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { report }
  })
  .post('/api/org/:auth0Id/reports', async ({ params, body, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('report.create')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Creating reports requires the report.create permission',
        false,
      )
    }
    const { student_id, report_type, period_start, period_end, title } = body as Record<
      string,
      unknown
    >

    // Scope gate, beside the capability gate and ahead of every write: a scoped
    // caller may only author for a student it can see, so an org-wide report
    // request (no student) is refused too — it would summarize the whole org.
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    const target = typeof student_id === 'string' ? student_id : null
    if (visible !== null && (target === null || !canSeeStudent(visible, target))) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
    }

    if (!report_type || !REPORT_TYPE_SET.has(report_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${[...REPORT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (student_id !== undefined && student_id !== null && !pickUuid(student_id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a uuid or null', false)
    }
    if (student_id && (await getStudent(auth0Id, student_id as string)) === null) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    if (period_start !== undefined && !isDate(period_start)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false)
    }
    if (period_end !== undefined && !isDate(period_end)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false)
    }

    const from = isDate(period_start) ? period_start : undefined
    const to = isDate(period_end) ? period_end : undefined
    const nextType = report_type as ReportType

    const content = await buildReportContent(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      from,
      to,
      report_type: nextType,
    })

    const student = student_id ? await getStudent(auth0Id, student_id as string) : null

    const report = await createReportRecord(auth0Id, {
      student_id: student_id ? (student_id as string) : null,
      report_type: nextType,
      title: typeof title === 'string' && title ? title : defaultReportTitle(nextType, student),
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to create report', true)
    }

    if (student?.account_auth0_id) {
      try {
        await notifyReportReady({
          auth0Id: student.account_auth0_id,
          title: 'Report ready',
          body: report.title,
          data: {},
          reportId: report.id,
          href: `/player/reports/${report.id}`,
          dedupeKey: `report_ready:${report.id}`,
        })
      } catch (error) {
        logger.error('report_ready_notification_error', {
          type: 'report_ready_notification_error',
          auth0Id: student.account_auth0_id,
          reportId: report.id,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }

    set.status = 201
    return { report }
  })
  .put('/api/org/:auth0Id/reports/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid report id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('report.create')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Updating reports requires the report.create permission',
        false,
      )
    }
    const existing = await getReport(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    // Fetch-then-check: this is the report's own student, fetched unscoped so a
    // refusal can be 403 rather than a 404 that hides the row's existence. Refuse
    // before buildReportContent aggregates that student's data and before any write.
    // A report with no student is org-level, so a scoped caller cannot edit it.
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    if (visible !== null && !(existing.student_id && canSeeStudent(visible, existing.student_id))) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
    }

    const { report_type, period_start, period_end, title } = body as Record<string, unknown>

    const toYmd = (v: unknown): string | null =>
      v === null || v === undefined
        ? null
        : typeof v === 'string'
          ? v
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : String(v)

    const nextType = (
      report_type === undefined ? existing.report_type : String(report_type)
    ) as ReportType
    if (!REPORT_TYPE_SET.has(nextType)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${[...REPORT_TYPE_SET].join(', ')}`,
        false,
      )
    }
    if (period_start !== undefined && period_start !== null && !isDate(period_start)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false)
    }
    if (
      period_end !== undefined &&
      period_end !== null &&
      !isIsoDate(period_end) &&
      !isDate(period_end)
    ) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false)
    }

    const from =
      period_start === undefined
        ? toYmd(existing.period_start)
        : isDate(period_start)
          ? period_start
          : null
    const to =
      period_end === undefined ? toYmd(existing.period_end) : isDate(period_end) ? period_end : null

    const content = await buildReportContent(auth0Id, {
      student_id: existing.student_id,
      from,
      to,
      report_type: nextType,
    })

    const report = await updateReportRecord(auth0Id, id, {
      report_type: nextType,
      title: typeof title === 'string' && title.trim() ? title.trim() : existing.title,
      period_start: from ?? null,
      period_end: to ?? null,
      content_json: content,
    })
    if (!report) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to update report', true)
    }
    set.status = 200
    return { report }
  })
  .delete('/api/org/:auth0Id/reports/:id', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid report id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('report.create')) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Deleting reports requires the report.create permission',
        false,
      )
    }
    // Fetch-then-check, before the delete: a scoped caller may not remove a
    // report for a student outside its teams.
    const existing = await getReport(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    const visible = await visibleStudentIds(auth0Id, caller.studentScope)
    if (visible !== null && !(existing.student_id && canSeeStudent(visible, existing.student_id))) {
      set.status = 403
      return buildError('FORBIDDEN', OUT_OF_SCOPE, false)
    }
    const deleted = await deleteReport(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
