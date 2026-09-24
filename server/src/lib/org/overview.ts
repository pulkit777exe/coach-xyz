// Org overview + global search data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'

export type OrgOverview = {
  student_count: number
  active_students: number
  sessions_this_month: number
  upcoming_events: number
  analyses_linked: number
  avg_attendance_rate: number | null
}

// ── Org Overview ─────────────────────────────────────────────────────────────

export const getOrgOverview = async (auth0Id: string): Promise<OrgOverview> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
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
      return (
        rows?.[0] ?? {
          student_count: 0,
          active_students: 0,
          sessions_this_month: 0,
          upcoming_events: 0,
          analyses_linked: 0,
          avg_attendance_rate: null,
        }
      )
    })) ?? {
      student_count: 0,
      active_students: 0,
      sessions_this_month: 0,
      upcoming_events: 0,
      analyses_linked: 0,
      avg_attendance_rate: null,
    }
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

export const searchOrg = async (auth0Id: string, query: string): Promise<OrgSearchResult> => {
  const q = query.trim().slice(0, 100)
  if (!q) return { students: [], schedule: [], reports: [], analyses: [] }
  const like = `%${q}%`

  return withHistoryStoreOrThrow(async (db) => {
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
      students: (students ?? []).map((s) => ({
        id: s.id,
        label: s.full_name,
        subtitle: [s.email, s.sport, s.position].filter(Boolean).join(' · ') || null,
      })),
      schedule: (schedule ?? []).map((e) => ({
        id: e.id,
        label: e.title,
        subtitle: `${e.event_type}${e.location ? ` · ${e.location}` : ''}`,
      })),
      reports: (reports ?? []).map((r) => ({
        id: r.id,
        label: r.title,
        subtitle: `${r.report_type}${r.full_name ? ` · ${r.full_name}` : ''}`,
      })),
      analyses: (analyses ?? []).map((a) => ({
        id: a.server_job_id,
        label: a.display_name || a.file_name || a.server_job_id,
        subtitle: a.student_id ? 'Linked to a player' : 'Unlinked',
      })),
    }
  })
}
