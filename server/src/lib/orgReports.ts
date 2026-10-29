// ── Org reports slice ────────────────────────────────────────────────────────
// Report CRUD. Assembly lives in orgReportContent; analysis lookups in
// orgAnalysisQueries; performance in orgPerformance; cross-entity views in
// orgInsights. Everything is re-exported here so existing importers and the
// orgData barrel keep one stable surface.
import { withHistoryStoreOrThrow as withHistoryStore } from './orgStore'
import { REPORT_TYPES } from './orgEnums'
import type { ReportType } from './orgEnums'

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportRecord = {
  id: string
  auth0_id: string
  student_id: string | null
  report_type: (typeof REPORT_TYPES)[number]
  title: string
  period_start: string | null
  period_end: string | null
  content_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ReportInput = {
  student_id?: string | null
  report_type: ReportType
  title: string
  period_start?: string | null
  period_end?: string | null
  content_json: Record<string, unknown>
}

const REPORT_SELECT = `
  select r.*, s.full_name
  from reports r
  left join students s on s.id = r.student_id
`

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const listReports = async (
  auth0Id: string,
  opts: { studentId?: string } = {},
): Promise<Array<ReportRecord & { full_name: string | null }>> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
        ${db.unsafe(REPORT_SELECT)}
        where r.auth0_id = ${auth0Id}
          and (${opts.studentId ?? null}::uuid is null or r.student_id = ${opts.studentId ?? null}::uuid)
        order by r.created_at desc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const getReport = async (
  auth0Id: string,
  id: string,
): Promise<(ReportRecord & { full_name: string | null }) | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      ${db.unsafe(REPORT_SELECT)}
      where r.auth0_id = ${auth0Id} and r.id = ${id}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const createReportRecord = async (
  auth0Id: string,
  input: ReportInput,
): Promise<ReportRecord | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<ReportRecord[]>`
      insert into reports (
        auth0_id, student_id, report_type, title, period_start, period_end, content_json
      ) values (
        ${auth0Id},
        ${input.student_id ?? null}::uuid,
        ${input.report_type},
        ${input.title},
        ${input.period_start ?? null}::date,
        ${input.period_end ?? null}::date,
        ${JSON.stringify(input.content_json)}::jsonb
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteReport = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    const rows = await db<{ id: string }[]>`
      delete from reports where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return Boolean(rows?.[0])
  })
  return res ?? false
}

export const updateReportRecord = async (
  auth0Id: string,
  id: string,
  input: {
    report_type: string
    title: string
    period_start: string | null
    period_end: string | null
    content_json: Record<string, unknown>
  },
): Promise<(ReportRecord & { full_name: string | null }) | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      update reports set
        report_type = ${input.report_type},
        title = ${input.title},
        period_start = ${input.period_start}::date,
        period_end = ${input.period_end}::date,
        content_json = ${JSON.stringify(input.content_json)}::jsonb,
        updated_at = now()
      where auth0_id = ${auth0Id} and id = ${id}
      returning *, (select full_name from students s where s.id = reports.student_id) as full_name;
    `
    return rows?.[0] ?? null
  })
}

// ── Re-exports (stable surface for routes, aiReportData, and orgData) ───────
export { getStudentAnalyses, listRecentAnalysisScores } from './orgAnalysisQueries'
export { buildPeriodLabel, buildReportContent } from './orgReportContent'
export {
  listPerformance,
  createPerformanceMetric,
  updatePerformanceMetric,
  deletePerformanceMetric,
  getStudentPerformanceSeries,
  getStudentTrends,
} from './orgPerformance'
export type { PerformanceMetric, PerformanceSeriesPoint, PerformanceInput } from './orgPerformance'
export { compareStudents, getOrgOverview, searchOrg } from './orgInsights'
export type { ComparisonStudent, OrgOverview, SearchItem, OrgSearchResult } from './orgInsights'
