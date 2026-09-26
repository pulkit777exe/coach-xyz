// Org overview + global search data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { uuidArrayLiteral } from './scope'

export type OrgOverview = {
  student_count: number
  active_students: number
  sessions_this_month: number
  upcoming_events: number
  analyses_linked: number
  avg_attendance_rate: number | null
}

/**
 * The zero rollup — also the whole answer for a caller who can see no students
 * (an unassigned coach). Returning this without querying is the difference
 * between "manages no team, so no numbers" and "the org's numbers, unfiltered".
 */
const EMPTY_OVERVIEW: OrgOverview = {
  student_count: 0,
  active_students: 0,
  sessions_this_month: 0,
  upcoming_events: 0,
  analyses_linked: 0,
  avg_attendance_rate: null,
}

// ── Org Overview ─────────────────────────────────────────────────────────────

/**
 * The org rollup, narrowed to the students the caller can see.
 *
 * `studentIds` is the request's scope answer from `lib/org/scope.ts`
 * (`visibleStudentIds`): `null` = org-wide, a list = those students only, `[]`
 * = none. Every number that hangs off a student is filtered by it — roster
 * counts, linked analyses and the 30-day attendance rate are all exact per
 * scope, because each of those rows carries a `student_id`.
 *
 * The two schedule numbers are deliberately NOT filtered: `schedule_events` has
 * no `team_id` and no `student_id` (see the DDL in `lib/historyStore.ts`), so
 * "sessions for team A this month" is not an answer this schema can produce
 * without joining events to attendance, which would count a session once per
 * player and over-count team sessions with missing attendance. They stay
 * org-wide calendar counts per the documented policy (AGENTS.md: "the schedule
 * is deliberately org-wide rather than hidden from coaches") — a club calendar,
 * not a player record. Everything player-keyed in the same panel is scoped.
 */
export const getOrgOverview = async (
  auth0Id: string,
  studentIds: string[] | null = null,
): Promise<OrgOverview> => {
  // `[]` (sees nothing) short-circuits: no ids, no rows, no store round-trip.
  if (studentIds !== null && studentIds.length === 0) return EMPTY_OVERVIEW
  // `null` binds SQL NULL, so `id = any(NULL::uuid[])` is never true and the
  // `not ${scoped}` branch admits every student — the org-wide case needs no
  // second query shape. `uuidArrayLiteral` is required for the list: a raw JS
  // array reaches Postgres as comma-joined text and the cast fails (see
  // `lib/org/scope.ts`).
  const scoped = studentIds !== null
  const scope = studentIds === null ? null : uuidArrayLiteral(studentIds)
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<OrgOverview[]>`
        select
          (select count(*)::int from students
             where auth0_id = ${auth0Id}
               and (not ${scoped} or id = any(${scope}::uuid[]))) as student_count,
          (select count(*)::int from students
             where auth0_id = ${auth0Id} and status = 'active'
               and (not ${scoped} or id = any(${scope}::uuid[]))) as active_students,
          -- Calendar counts: org-wide by design, see the note above.
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id}
               and date_trunc('month', starts_at) = date_trunc('month', now())) as sessions_this_month,
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id} and status = 'scheduled' and starts_at > now()) as upcoming_events,
          -- Already student-keyed (unlinked analyses are excluded), so the
          -- scope filter makes this count exact.
          (select count(*)::int from analysis_history
             where auth0_id = ${auth0Id} and student_id is not null
               and (not ${scoped} or student_id = any(${scope}::uuid[]))) as analyses_linked,
          (
            select case when count(*) = 0 then null
                 else round((count(*) filter (where status in ('present', 'late')) * 100.0) / count(*), 1)
            end
            from attendance
            where auth0_id = ${auth0Id}
              and (not ${scoped} or student_id = any(${scope}::uuid[]))
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

/**
 * Global search, narrowed to the students the caller can see.
 *
 * `studentIds` follows the same convention as `getOrgOverview` (null = org-wide,
 * list = those students, [] = none). Roster rows are scope-exact. Reports and
 * analyses keep the rows that belong to no student (`student_id is null`) —
 * those name no player, so they leak nothing about another team — and drop
 * every row keyed to a student outside the scope. Schedule stays org-wide for
 * the same schema reason as the overview's calendar counts.
 */
export const searchOrg = async (
  auth0Id: string,
  query: string,
  studentIds: string[] | null = null,
): Promise<OrgSearchResult> => {
  const q = query.trim().slice(0, 100)
  if (!q) return { students: [], schedule: [], reports: [], analyses: [] }
  // A caller who sees no student gets no hits at all, and never reaches SQL: an
  // empty array binds as '' rather than a uuid[] literal, and "manages no team"
  // outranks the org-wide schedule (the same zeroes the overview returns).
  if (studentIds !== null && studentIds.length === 0) {
    return { students: [], schedule: [], reports: [], analyses: [] }
  }
  const like = `%${q}%`
  // See `getOrgOverview`: `null` is what makes `not ${scoped}` admit the whole
  // org, so org-wide needs no second query shape, and a list must go through
  // `uuidArrayLiteral` or the `::uuid[]` cast fails.
  const scoped = studentIds !== null
  const scope = studentIds === null ? null : uuidArrayLiteral(studentIds)

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
          and (not ${scoped} or id = any(${scope}::uuid[]))
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
          and (not ${scoped} or r.student_id is null or r.student_id = any(${scope}::uuid[]))
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
          and (not ${scoped} or a.student_id is null or a.student_id = any(${scope}::uuid[]))
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
