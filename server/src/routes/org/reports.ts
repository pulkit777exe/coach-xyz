import {
  buildReportContent,
  createReportRecord,
  deleteReport,
  getReport,
  listReports,
  updateReportRecord,
} from '../../lib/orgReports'
import { getStudent } from '../../lib/orgRoster'
import { defaultReportTitle, isDate, isIsoDate } from '../../lib/orgValidate'
import { REPORT_TYPE_SET } from './shared'
import type { ReportType } from '../../lib/orgEnums'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Reports ────────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/reports', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const reports = await listReports(auth0Id, {
      studentId: url.searchParams.get('studentId') ?? undefined,
    })
    set.status = 200
    return { reports }
  })
  .get('/api/org/:auth0Id/reports/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const report = await getReport(auth0Id, id)
    if (!report) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { report }
  })
  .post('/api/org/:auth0Id/reports', async ({ params, body, set }) => {
    const { auth0Id } = params
    const { student_id, report_type, period_start, period_end, title } = body as Record<
      string,
      unknown
    >

    if (!report_type || !REPORT_TYPE_SET.has(report_type as string)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${[...REPORT_TYPE_SET].join(', ')}`,
        false,
      )
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
    set.status = 201
    return { report }
  })
  .put('/api/org/:auth0Id/reports/:id', async ({ params, body, set }) => {
    const { auth0Id, id } = params
    const existing = await getReport(auth0Id, id)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
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
  .delete('/api/org/:auth0Id/reports/:id', async ({ params, set }) => {
    const { auth0Id, id } = params
    const deleted = await deleteReport(auth0Id, id)
    if (!deleted) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }
    set.status = 200
    return { deleted: true }
  })
