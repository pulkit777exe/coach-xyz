// ── Report content assembly ─────────────────────────────────────────────────
// Pure-ish composition of attendance, performance and recent analyses into the
// JSON a report stores. Lookups belong to their slices; only assembly lives
// here.
import { attendanceSummary } from './orgAttendance'
import { getStudent } from './orgRoster'
import { getStudentAnalyses, listRecentAnalysisScores } from './orgAnalysisQueries'
import { getStudentPerformanceSeries } from './orgPerformance'
import { getOrgOverview } from './orgInsights'
import type { ReportType } from './orgEnums'

export function buildPeriodLabel(opts: {
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

  const formScores = series.filter((point) => point.metric_key === 'form_score')
  const formScoreAvg =
    formScores.length > 0
      ? Math.round((formScores.reduce((sum, point) => sum + point.metric_value, 0) / formScores.length) * 10) /
        10
      : null
  const formScoreLatest = formScores.length > 0 ? formScores[formScores.length - 1].metric_value : null

  const orgBlock = student_id
    ? null
    : await getOrgOverview(auth0Id).then((overview) => ({
        student_count: overview.student_count,
        active_students: overview.active_students,
        sessions_this_month: overview.sessions_this_month,
        upcoming_events: overview.upcoming_events,
        analyses_linked: overview.analyses_linked,
        avg_attendance_rate: overview.avg_attendance_rate,
      }))

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
    latest_analysis_at: formScores.length > 0 ? formScores[formScores.length - 1].measured_at : null,
  }
  const analysesBlock = analyses.map((analysis) => ({
    server_job_id: analysis.server_job_id,
    requested_at: analysis.requested_at,
    display_name: analysis.display_name,
    student_id: analysis.student_id,
    form_score:
      typeof analysis.summary_json === 'object' &&
      analysis.summary_json &&
      'form_score' in analysis.summary_json
        ? Number((analysis.summary_json as Record<string, unknown>).form_score)
        : null,
  }))

  let summary: string | null
  if (orgBlock) {
    const parts: string[] = []
    parts.push(`${orgBlock.student_count} student(s) on the roster (${orgBlock.active_students} active).`)
    if (orgBlock.avg_attendance_rate !== null) {
      parts.push(`Roster attendance over the last 30 days: ${orgBlock.avg_attendance_rate}%.`)
    }
    if (orgBlock.sessions_this_month > 0) {
      parts.push(`${orgBlock.sessions_this_month} session(s) scheduled this month.`)
    }
    if (orgBlock.analyses_linked > 0) {
      parts.push(`${orgBlock.analyses_linked} analysis(ies) linked to students.`)
    }
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
