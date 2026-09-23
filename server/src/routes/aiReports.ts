// ── AI report routes ────────────────────────────────────────────────────────
// Guarded endpoints for one-click AI report generation:
//   POST /api/org/:auth0Id/reports/ai        — validate, build context, enqueue
//   GET  /api/org/:auth0Id/reports/ai/:id    — poll status + report when done
// The engine call runs in the BullMQ coachai-report worker (queue.ts). Deps
// are injectable so tests stay DB/Redis-free.

import { Elysia } from 'elysia'
import { buildError } from '../lib/errors'
import type { CoachAIError } from '../types'
import { serviceGuard } from '../lib/serviceGuard'
import { checkAiReportLimit, rateLimited } from '../lib/ratelimit'
import { REPORT_TYPES } from '../lib/orgEnums'
import type { ReportType } from '../lib/orgEnums'
import { isDate, defaultReportTitle } from '../lib/orgValidate'
import { buildReportContent, getAiReportJob } from '../lib/aiReportData'
import type { AiReportJob } from '../lib/aiReportData'
import { getReport } from '../lib/orgData'
import type { ReportRecord } from '../lib/orgData'
import { enqueueAiReport } from '../lib/queue'
import type { AiReportPayload } from '../lib/queue'

const REPORT_TYPE_SET: ReadonlySet<string> = new Set(REPORT_TYPES)

export type AiReportRequest = {
  student_id?: string | null
  report_type: ReportType
  period_start?: string | null
  period_end?: string | null
  title?: string | null
}

export function validateAiReportBody(
  body: unknown,
): { ok: true; value: AiReportRequest } | { ok: false; error: CoachAIError } {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'Body must be a JSON object', false),
    }
  }
  const b = body as Record<string, unknown>

  const reportType = typeof b.report_type === 'string' ? b.report_type : ''
  if (!reportType || !REPORT_TYPE_SET.has(reportType)) {
    return {
      ok: false,
      error: buildError(
        'INVALID_REQUEST',
        `report_type must be one of ${REPORT_TYPES.join(', ')}`,
        false,
      ),
    }
  }
  if (
    b.student_id !== undefined &&
    (typeof b.student_id !== 'string' || !(b.student_id as string).trim())
  ) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'student_id must be a non-empty string', false),
    }
  }
  if (b.period_start !== undefined && b.period_start !== null && !isDate(b.period_start)) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'period_start must be YYYY-MM-DD', false),
    }
  }
  if (b.period_end !== undefined && b.period_end !== null && !isDate(b.period_end)) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'period_end must be YYYY-MM-DD', false),
    }
  }
  if (
    b.title !== undefined &&
    b.title !== null &&
    (typeof b.title !== 'string' || !(b.title as string).trim())
  ) {
    return {
      ok: false,
      error: buildError('INVALID_REQUEST', 'title must be a non-empty string', false),
    }
  }

  return {
    ok: true,
    value: {
      student_id:
        typeof b.student_id === 'string' && (b.student_id as string).trim()
          ? (b.student_id as string).trim()
          : null,
      report_type: reportType as ReportType,
      period_start: isDate(b.period_start) ? (b.period_start as string) : null,
      period_end: isDate(b.period_end) ? (b.period_end as string) : null,
      title:
        typeof b.title === 'string' && (b.title as string).trim()
          ? (b.title as string).trim()
          : null,
    },
  }
}

type GetReportById = (
  auth0Id: string,
  id: string,
) => Promise<(ReportRecord & { full_name: string | null }) | null>

export type AiReportsDeps = {
  buildContext?: typeof buildReportContent
  enqueue?: (payload: Omit<AiReportPayload, 'report_job_id'>) => Promise<string | null>
  getJob?: (reportJobId: string) => Promise<AiReportJob | null>
  getReportById?: GetReportById
}

export const aiReportsRoute = (deps: AiReportsDeps = {}) => {
  const buildContext = deps.buildContext ?? buildReportContent
  const enqueue = deps.enqueue ?? enqueueAiReport
  const getJob = deps.getJob ?? getAiReportJob
  const fetchReport = deps.getReportById ?? getReport

  return new Elysia({ name: 'aiReports' })
    .use(serviceGuard)
    .post('/api/org/:auth0Id/reports/ai', async ({ params, body, set }) => {
      const { auth0Id } = params as { auth0Id: string }
      if (!auth0Id) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
      }
      const { allowed } = await checkAiReportLimit(auth0Id)
      if (!allowed) {
        return rateLimited(set, 'Hourly AI report limit reached for this organization.')
      }

      const validated = validateAiReportBody(body)
      if (!validated.ok) {
        set.status = 400
        return validated.error
      }
      const value = validated.value

      const context = await buildContext(auth0Id, {
        student_id: value.student_id ?? undefined,
        from: value.period_start ?? undefined,
        to: value.period_end ?? undefined,
        report_type: value.report_type,
      })

      const studentBlock =
        context.student && typeof context.student === 'object'
          ? (context.student as Record<string, unknown>)
          : null
      const sport = typeof studentBlock?.sport === 'string' ? (studentBlock.sport as string) : null
      const studentName =
        typeof studentBlock?.full_name === 'string' ? (studentBlock.full_name as string) : null

      const title =
        value.title ??
        defaultReportTitle(value.report_type, studentName ? { full_name: studentName } : null)

      const reportJobId = await enqueue({
        auth0_id: auth0Id,
        report_type: value.report_type,
        period_start: value.period_start,
        period_end: value.period_end,
        title,
        student_id: value.student_id ?? null,
        sport,
        student_name: studentName,
        report_context: context,
      })

      if (!reportJobId) {
        set.status = 503
        return buildError(
          'QUEUE_UNAVAILABLE',
          'Job queue is not configured. Please try again later.',
          true,
        )
      }

      set.status = 201
      return { report_job_id: reportJobId, status: 'queued' }
    })
    .get('/api/org/:auth0Id/reports/ai/:reportJobId', async ({ params, set }) => {
      const { auth0Id, reportJobId } = params as {
        auth0Id: string
        reportJobId: string
      }
      if (!auth0Id || !reportJobId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing auth0Id or reportJobId parameter', false)
      }

      const job = await getJob(reportJobId)
      // Same 404 for missing and cross-org ids so account boundaries don't leak.
      if (!job || job.auth0_id !== auth0Id) {
        set.status = 404
        return buildError('NOT_FOUND', 'Report job not found', false)
      }

      if (job.status === 'done' && job.report_id) {
        const report = await fetchReport(auth0Id, job.report_id)
        set.status = 200
        return {
          report_job_id: job.report_job_id,
          status: job.status,
          report,
        }
      }

      set.status = 200
      return {
        report_job_id: job.report_job_id,
        status: job.status,
        report: null,
      }
    })
}

export default aiReportsRoute()
