// Reports data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { ANALYSES_SELECT_COLUMNS } from '../analyses'
import type { DashboardAnalysis } from '../analyses'
import { REPORT_TYPES } from '../orgEnums'
import type { ReportType } from '../orgEnums'
import { attendanceSummary } from './attendance'
import { getStudentPerformanceSeries } from './performance'
import { getStudent } from './students'
import { getOrgOverview } from './overview'
import { uuidArrayLiteral } from './scope'

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

// ── Reports ──────────────────────────────────────────────────────────────────

/**
 * `content_json` is jsonb and must be bound as an object. These two writers
 * used to bind `${JSON.stringify(obj)}::jsonb`, which Postgres stores as a
 * jsonb *string* — every consumer then read `content.period` off a string and
 * got undefined, so the report rendered empty. One such row is still on disk.
 * Reads normalize defensively so a pre-fix row is not lost; the value is
 * already an object for every row written after the fix.
 */
type ContentJson = Record<string, unknown>

const withNormalizedContent = <T extends { content_json: unknown }>(row: T): T => ({
  ...row,
  content_json: normalizeContentJson(row.content_json),
})

const normalizeContentJson = (value: unknown): ContentJson => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as ContentJson
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ContentJson
      }
    } catch {
      // fall through to the empty object
    }
  }
  return {}
}

export const getStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
  limit = 200,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<DashboardAnalysis[]>`
        select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
        from analysis_history a
        left join video_conversations v on a.session_token = v.session_token
        where a.auth0_id = ${auth0Id} and a.student_id = ${studentId}
        order by a.requested_at desc
        limit ${limit};
      `
      return rows ?? []
    })) ?? []
  )
}

export type ReportInput = {
  student_id?: string | null
  report_type: ReportType
  title: string
  period_start?: string | null
  period_end?: string | null
  content_json: Record<string, unknown>
}

/**
 * Team scope for report reads. `reports` rows carry only `student_id` (no
 * `team_id`), so visibility is purely "is that student visible to this caller".
 *
 * `visibleStudentIds` absent = the caller sees the whole org (owner/admin, and
 * the org-wide readers analyst/medical). Present = the caller's visible student
 * set, and it stays meaningful when EMPTY: `[]` means "an unassigned coach",
 * who must see nothing, and must not be confused with org-wide.
 *
 * The ids bind through `uuidArrayLiteral` (the shared owner of `= any(...::uuid[])`
 * — see its doc comment): a raw JS array reaches Postgres as comma-joined text
 * and the cast fails with `22P02 malformed array literal`, which would 500 every
 * scoped read. The empty scope binds NULL, and `= any(NULL)` is never true, so an
 * unassigned coach matches nothing rather than everything.
 */
export type ReportScope = { visibleStudentIds?: string[] }

export const listReports = async (
  auth0Id: string,
  opts: ReportScope & { studentId?: string } = {},
): Promise<Array<ReportRecord & { full_name: string | null }>> => {
  const scoped = opts.visibleStudentIds !== undefined
  const scopeParam =
    scoped && opts.visibleStudentIds!.length > 0 ? uuidArrayLiteral(opts.visibleStudentIds!) : null
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
        select r.*, s.full_name
        from reports r
        left join students s on s.id = r.student_id
        where r.auth0_id = ${auth0Id}
          and (${opts.studentId ?? null}::uuid is null or r.student_id = ${opts.studentId ?? null}::uuid)
          and (not ${scoped} or r.student_id = any(${scopeParam}::uuid[]))
        order by r.created_at desc;
      `
      return (rows ?? []).map(withNormalizedContent)
    })) ?? []
  )
}

export const getReport = async (
  auth0Id: string,
  id: string,
  opts: ReportScope = {},
): Promise<(ReportRecord & { full_name: string | null }) | null> => {
  const scoped = opts.visibleStudentIds !== undefined
  const scopeParam =
    scoped && opts.visibleStudentIds!.length > 0 ? uuidArrayLiteral(opts.visibleStudentIds!) : null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      select r.*, s.full_name
      from reports r
      left join students s on s.id = r.student_id
      where r.auth0_id = ${auth0Id} and r.id = ${id}
        and (not ${scoped} or r.student_id = any(${scopeParam}::uuid[]))
      limit 1;
    `
    return rows?.[0] ? withNormalizedContent(rows[0]) : null
  })
}

export const createReportRecord = async (
  auth0Id: string,
  input: ReportInput,
): Promise<ReportRecord | null> => {
  return withHistoryStoreOrThrow(async (db) => {
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
        ${input.content_json}::jsonb
      )
      returning *;
    `
    return rows?.[0] ? withNormalizedContent(rows[0]) : null
  })
}

export const deleteReport = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<{ id: string }[]>`
      delete from reports where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const listRecentAnalysisScores = async (
  auth0Id: string,
  limit = 20,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<DashboardAnalysis[]>`
        select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
        from analysis_history a
        left join video_conversations v on a.session_token = v.session_token
        where a.auth0_id = ${auth0Id}
          and a.complete = true
          and a.summary_json is not null
          and (a.summary_json->>'form_score') is not null
        order by a.requested_at desc
        limit ${limit};
      `
      return rows ?? []
    })) ?? []
  )
}

function buildPeriodLabel(opts: {
  reportType?: ReportType | null
  from?: string | null
  to?: string | null
}): string {
  const { reportType, from, to } = opts
  const fmt = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  if (reportType === 'monthly') {
    const anchor = from ? new Date(`${from.slice(0, 10)}T00:00:00`) : new Date()
    return `Month of ${anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
  }
  if (from && to) return `from ${fmt(from)} to ${fmt(to)}`
  if (from) return `since ${fmt(from)}`
  if (to) return `through ${fmt(to)}`
  return 'All time'
}

export const buildReportContent = async (
  auth0Id: string,
  opts: {
    student_id?: string | null
    from?: string | null
    to?: string | null
    report_type?: ReportType | null
  } = {},
): Promise<Record<string, unknown>> => {
  const { student_id, from, to, report_type } = opts
  const [attendance, series, analyses] = await Promise.all([
    attendanceSummary(auth0Id, {
      from: from ?? undefined,
      to: to ?? undefined,
      studentId: student_id ?? undefined,
    }),
    student_id
      ? getStudentPerformanceSeries(auth0Id, student_id, {
          from: from ?? undefined,
          to: to ?? undefined,
        })
      : Promise.resolve([]),
    student_id
      ? getStudentAnalyses(auth0Id, student_id, 20)
      : listRecentAnalysisScores(auth0Id, 20),
  ])

  const student = student_id ? await getStudent(auth0Id, student_id) : null

  const formScores = series.filter((s) => s.metric_key === 'form_score')
  const formScoreAvg =
    formScores.length > 0
      ? Math.round(
          (formScores.reduce((acc, s) => acc + s.metric_value, 0) / formScores.length) * 10,
        ) / 10
      : null
  const formScoreLatest =
    formScores.length > 0 ? formScores[formScores.length - 1].metric_value : null

  const orgBlock = student_id
    ? null
    : await (async () => {
        const o = await getOrgOverview(auth0Id)
        return {
          student_count: o.student_count,
          active_students: o.active_students,
          sessions_this_month: o.sessions_this_month,
          upcoming_events: o.upcoming_events,
          analyses_linked: o.analyses_linked,
          avg_attendance_rate: o.avg_attendance_rate,
        }
      })()

  const attendanceBlock = {
    total_records: attendance.total_records,
    present: attendance.present,
    absent: attendance.absent,
    late: attendance.late,
    excused: attendance.excused,
    attendance_rate: attendance.attendance_rate,
  }
  const performanceBlock = {
    form_score_avg: formScoreAvg,
    form_score_latest: formScoreLatest,
    total_sessions: formScores.length,
    latest_analysis_at:
      formScores.length > 0 ? formScores[formScores.length - 1].measured_at : null,
  }
  const analysesBlock = analyses.map((a) => ({
    server_job_id: a.server_job_id,
    requested_at: a.requested_at,
    display_name: a.display_name,
    student_id: a.student_id,
    form_score:
      typeof a.summary_json === 'object' && a.summary_json && 'form_score' in a.summary_json
        ? Number((a.summary_json as Record<string, unknown>).form_score)
        : null,
  }))

  let summary: string | null
  if (orgBlock) {
    const parts: string[] = []
    parts.push(
      `${orgBlock.student_count} student(s) on the roster (${orgBlock.active_students} active).`,
    )
    if (orgBlock.avg_attendance_rate !== null) {
      parts.push(`Roster attendance over the last 30 days: ${orgBlock.avg_attendance_rate}%.`)
    }
    if (orgBlock.sessions_this_month > 0)
      parts.push(`${orgBlock.sessions_this_month} session(s) scheduled this month.`)
    if (orgBlock.analyses_linked > 0)
      parts.push(`${orgBlock.analyses_linked} analysis(ies) linked to students.`)
    if (performanceBlock.form_score_avg !== null) {
      parts.push(
        `Average form score across the ${performanceBlock.total_sessions} most recent analyzed session(s) is ${performanceBlock.form_score_avg}/10.`,
      )
    } else if (attendanceBlock.total_records > 0) {
      parts.push(
        `Attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}% across ${attendanceBlock.total_records} record(s).`,
      )
    }
    summary = parts.length ? parts.join(' ') : 'No data is available yet for this academy.'
  } else if (performanceBlock.form_score_avg !== null) {
    summary = `Average form score across ${performanceBlock.total_sessions} analyzed session(s) is ${performanceBlock.form_score_avg}/10${
      attendanceBlock.total_records > 0
        ? `; attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}%`
        : ''
    }.`
  } else if (attendanceBlock.total_records > 0) {
    summary = `Attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}% across ${attendanceBlock.total_records} record(s).`
  } else {
    summary = 'No attendance or performance data is available for the selected period.'
  }

  return {
    generated_at: new Date().toISOString(),
    student: student
      ? {
          id: student.id,
          full_name: student.full_name,
          sport: student.sport,
          position: student.position,
          status: student.status,
        }
      : null,
    period: {
      start: from ?? null,
      end: to ?? null,
      label: buildPeriodLabel({ reportType: report_type, from, to }),
    },
    attendance: attendanceBlock,
    performance: performanceBlock,
    analyses: analysesBlock,
    summary,
    org: orgBlock,
  }
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
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      update reports set
        report_type = ${input.report_type},
        title = ${input.title},
        period_start = ${input.period_start}::date,
        period_end = ${input.period_end}::date,
        content_json = ${input.content_json}::jsonb,
        updated_at = now()
      where auth0_id = ${auth0Id} and id = ${id}
      returning *, (select full_name from students s where s.id = reports.student_id) as full_name;
    `
    return rows?.[0] ? withNormalizedContent(rows[0]) : null
  })
}
