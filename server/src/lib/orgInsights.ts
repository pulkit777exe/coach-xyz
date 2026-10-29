// ── Org insights ────────────────────────────────────────────────────────────
// Cross-entity views: per-student comparison, the org dashboard snapshot, and
// global search. Assembly lives here; lookups stay in their slice modules.
import { withHistoryStoreOrThrow as withHistoryStore } from './orgStore'
import { getStudent } from './orgRoster'
import { getStudentPerformanceSeries } from './orgPerformance'

// ── Comparison ───────────────────────────────────────────────────────────────

export type ComparisonStudent = {
  student_id: string
  full_name: string
  latest: number | null
  avg: number | null
  points: Array<{ measured_at: string; metric_value: number }>
}

/** Compare multiple students on a single metric key (latest, average, points). */
export const compareStudents = async (
  auth0Id: string,
  studentIds: string[],
  metricKey = 'form_score',
): Promise<ComparisonStudent[]> => {
  const result: ComparisonStudent[] = []

  for (const studentId of studentIds) {
    const series = await getStudentPerformanceSeries(auth0Id, studentId, {})
    const values = series.filter((point) => point.metric_key === metricKey).map((point) => point.metric_value)
    const student = await getStudent(auth0Id, studentId)

    result.push({
      student_id: studentId,
      full_name: student?.full_name ?? 'Unknown',
      latest: values.length > 0 ? values[values.length - 1] : null,
      avg:
        values.length > 0
          ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
          : null,
      points: series
        .filter((point) => point.metric_key === metricKey)
        .map((point) => ({ measured_at: point.measured_at, metric_value: point.metric_value })),
    })
  }

  return result
}

// ── Org overview ─────────────────────────────────────────────────────────────

export type OrgOverview = {
  student_count: number
  active_students: number
  sessions_this_month: number
  upcoming_events: number
  analyses_linked: number
  avg_attendance_rate: number | null
}

const EMPTY_OVERVIEW: OrgOverview = {
  student_count: 0,
  active_students: 0,
  sessions_this_month: 0,
  upcoming_events: 0,
  analyses_linked: 0,
  avg_attendance_rate: null,
}

export const getOrgOverview = async (auth0Id: string): Promise<OrgOverview> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<OrgOverview[]>`
        select
          (select count(*)::int from students where auth0_id = ${auth0Id}) as student_count,
          (select count(*)::int from students where auth0_id = ${auth0Id} and status = 'active') as active_students,
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id}
               and date_trunc('month', starts_at) = date_trunc('month', now())) as sessions_this_month,
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id} and status = 'scheduled' and starts_at > now()) as upcoming_events,
          (select count(*)::int from analysis_history
             where auth0_id = ${auth0Id} and student_id is not null) as analyses_linked,
          (
            select case when count(*) = 0 then null
                 else round((count(*) filter (where status in ('present', 'late')) * 100.0) / count(*), 1)
            end
            from attendance
            where auth0_id = ${auth0Id}
              and session_date >= current_date - interval '30 days'
          ) as avg_attendance_rate;
      `
      return rows?.[0] ?? EMPTY_OVERVIEW
    })) ?? EMPTY_OVERVIEW
  )
}

// ── Global search ────────────────────────────────────────────────────────────

export type SearchItem = {
  id: string
  label: string
  subtitle: string | null
}

export type OrgSearchResult = {
  students: SearchItem[]
  schedule: SearchItem[]
  reports: SearchItem[]
  analyses: SearchItem[]
}

const EMPTY_SEARCH: OrgSearchResult = { students: [], schedule: [], reports: [], analyses: [] }

export const searchOrg = async (auth0Id: string, query: string): Promise<OrgSearchResult> => {
  const term = query.trim().slice(0, 100)
  if (!term) return EMPTY_SEARCH
  const like = `%${term}%`

  return (
    (await withHistoryStore(async (db) => {

      const [students, schedule, reports, analyses] = await Promise.all([
        db<
          {
            id: string
            full_name: string
            email: string | null
            sport: string | null
            position: string | null
          }[]
        >`
          select id, full_name, email, sport, "position"
          from students
          where auth0_id = ${auth0Id}
            and (full_name ilike ${like} or email ilike ${like} or sport ilike ${like} or "position" ilike ${like})
          order by full_name asc
          limit 8;
        `,
        db<
          {
            id: string
            title: string
            event_type: string
            starts_at: string
            location: string | null
          }[]
        >`
          select id, title, event_type, starts_at, location
          from schedule_events
          where auth0_id = ${auth0Id}
            and (title ilike ${like} or location ilike ${like} or event_type ilike ${like} or description ilike ${like})
          order by starts_at desc
          limit 8;
        `,
        db<
          {
            id: string
            title: string
            report_type: string
            created_at: string
            full_name: string | null
          }[]
        >`
          select r.id, r.title, r.report_type, r.created_at, s.full_name
          from reports r
          left join students s on r.student_id = s.id
          where r.auth0_id = ${auth0Id}
            and (r.title ilike ${like} or r.report_type ilike ${like} or s.full_name ilike ${like})
          order by r.created_at desc
          limit 8;
        `,
        db<
          {
            server_job_id: string
            display_name: string | null
            student_id: string | null
            requested_at: string
            file_name: string | null
          }[]
        >`
          select a.server_job_id, a.display_name, a.student_id, a.requested_at, v.file_name
          from analysis_history a
          left join video_conversations v on a.session_token = v.session_token
          where a.auth0_id = ${auth0Id}
            and (a.display_name ilike ${like} or a.server_job_id ilike ${like} or v.file_name ilike ${like})
          order by a.requested_at desc
          limit 8;
        `,
      ])

      return {
        students: (students ?? []).map((student) => ({
          id: student.id,
          label: student.full_name,
          subtitle: [student.email, student.sport, student.position].filter(Boolean).join(' · ') || null,
        })),
        schedule: (schedule ?? []).map((event) => ({
          id: event.id,
          label: event.title,
          subtitle: `${event.event_type}${event.location ? ` · ${event.location}` : ''}`,
        })),
        reports: (reports ?? []).map((report) => ({
          id: report.id,
          label: report.title,
          subtitle: `${report.report_type}${report.full_name ? ` · ${report.full_name}` : ''}`,
        })),
        analyses: (analyses ?? []).map((analysis) => ({
          id: analysis.server_job_id,
          label: analysis.display_name || analysis.file_name || analysis.server_job_id,
          subtitle: analysis.student_id ? 'Linked to a player' : 'Unlinked',
        })),
      }
    })) ?? EMPTY_SEARCH
  )
}
