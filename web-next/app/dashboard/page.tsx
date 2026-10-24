import type { Metadata } from 'next'
import {
  getDashboardStats,
  getDashboardAnalyses,
  getMySchedule,
  getMyAnalyses,
  getMyReports,
  getMyObjectives,
} from '@/lib/serverData'
import { orgSchedule, orgReports, orgOverview } from '@/lib/serverData'
import type { ScheduleEvent, ReportRecord, OrgOverview } from '@/lib/org'
import type { DashboardPlayerAnalysis, MyObjectives } from '@/lib/meApi'
import Link from 'next/link'
import {
  CalendarIcon,
  FileTextIcon,
  ClockIcon,
  CalendarDays,
  ClipboardCheck,
  UserPlus,
  Users,
  Plus,
  Video,
} from 'lucide-react'
import { Badge } from '@/components/9ui/ui/badge'
import { loadPage } from './_shell'

export const metadata: Metadata = {
  title: 'Dashboard | CoachXYZ',
  description: 'Overview of your organization, analyses, and activity.',
}

function overviewTiles(overview: OrgOverview) {
  return [
    {
      icon: Users,
      label: 'Students',
      value: overview.student_count,
      href: '/dashboard/students',
    },
    {
      icon: CalendarDays,
      label: 'Upcoming Events',
      value: overview.upcoming_events,
      href: '/dashboard/schedule',
    },
    {
      icon: ClipboardCheck,
      label: 'Sessions This Month',
      value: overview.sessions_this_month,
      href: '/dashboard/attendance',
    },
  ]
}

export default async function DashboardPage() {
  // Gate first: org-role players branch to the personal view before any org
  // fetches run. The second call is gate-deduped; it only runs its fetchers.
  const { role } = await loadPage('org', {})

  // ── Personal view for players (org role) ───────────────────────────────
  // Players see only their own data via the self-scoped /api/me/* APIs —
  // never the org roster, stats, or admin surfaces.
  if (role === 'player') {
    return <PlayerHome />
  }

  const canInvite = role === 'owner' || role === 'head_coach'
  // All staff roles get the coaching workspace; players get the personal view.
  const showOrgSection =
    role === 'owner' || role === 'head_coach' || role === 'junior_coach'

  let stats = null
  let analyses = null
  let upcomingEvents: ScheduleEvent[] | null = null
  let recentReports: ReportRecord[] | null = null
  let overview: OrgOverview | null = null
  let error: string | null = null

  try {
    const now = new Date()
    const inThirtyDays = new Date()
    inThirtyDays.setDate(inThirtyDays.getDate() + 30)
    const { data } = await loadPage('org', {
      stats: ({ auth0Id }) => getDashboardStats(auth0Id),
      analyses: ({ auth0Id }) => getDashboardAnalyses(auth0Id, 20, 0),
      schedule: ({ auth0Id }) =>
        orgSchedule(auth0Id, { from: now.toISOString(), to: inThirtyDays.toISOString() }),
      reports: ({ auth0Id }) => orgReports(auth0Id),
      overview: ({ auth0Id }) => orgOverview(auth0Id),
    })
    const statsRes = data.stats
    const analysesRes = data.analyses
    const scheduleRes = data.schedule
    const reportsRes = data.reports
    const overviewRes = data.overview
    stats = statsRes.stats
    analyses = analysesRes.analyses
    upcomingEvents = scheduleRes.events
      .filter((e) => e.status === 'scheduled' && new Date(e.starts_at).getTime() >= now.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5)
    recentReports = reportsRes.reports.slice(0, 4)
    overview = overviewRes.overview
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    error = err instanceof Error ? err.message : 'Failed to load dashboard data'
  }

  const statCards = stats
    ? [
        { label: 'Total Analyses', value: stats.total_analyses },
        { label: 'Completed', value: stats.completed_analyses },
        { label: 'In Progress', value: stats.in_progress_analyses },
        { label: 'Downloads', value: stats.total_downloads },
      ]
    : []

  const tiles = overview ? overviewTiles(overview) : []

  return (
    <div className="mx-auto max-w-[760px] px-6 py-8">
      <h1 className="text-[28px] font-bold tracking-tight text-[var(--marketing-white)]">Home</h1>
      <p className="mt-1 text-sm text-[var(--marketing-white)]/60">Your coaching organization at a glance.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-white/5 px-4 py-3 text-sm text-danger">
          Failed to load dashboard data. Please try again later.
        </div>
      )}

      {statCards.length > 0 && (
        <div className="mt-6 grid grid-cols-2 divide-border rounded-xl border border-[var(--marketing-white)]/10 glass-panel sm:grid-cols-4 sm:divide-x">
          {statCards.map((stat) => (
            <div key={stat.label} className="px-5 py-4">
              <p className="text-2xl font-bold tracking-tight text-[var(--marketing-white)]">{stat.value}</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-[var(--marketing-white)]/60">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href="/#analyze"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-3 transition-colors hover:bg-white/10"
        >
          <Plus className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
          <span className="text-[13px] font-medium text-[var(--marketing-white)]">New analysis</span>
        </Link>
        <Link
          href="/dashboard/students"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-3 transition-colors hover:bg-white/10"
        >
          <Users className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
          <span className="text-[13px] font-medium text-[var(--marketing-white)]">Add student</span>
        </Link>
        <Link
          href="/dashboard/schedule"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-3 transition-colors hover:bg-white/10"
        >
          <CalendarDays className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
          <span className="text-[13px] font-medium text-[var(--marketing-white)]">Schedule event</span>
        </Link>
        {canInvite && (
          <Link
            href="/dashboard/members"
            className="flex items-center gap-2.5 rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-3 transition-colors hover:bg-white/10"
          >
            <UserPlus className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
            <span className="text-[13px] font-medium text-[var(--marketing-white)]">Invite member</span>
          </Link>
        )}
      </div>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Recents</h2>
          <Link
            href="/dashboard/history"
            className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]"
          >
            View all
          </Link>
        </div>
        {!analyses || analyses.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            No analyses yet — run your first one above.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {analyses.slice(0, 5).map((a) => {
              const score =
                a.summary_json &&
                typeof a.summary_json === 'object' &&
                'form_score' in a.summary_json
                  ? (a.summary_json as { form_score: number }).form_score
                  : null
              return (
                <li key={a.server_job_id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                  <Link
                    href={`/dashboard/analysis/${a.server_job_id}`}
                    className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                  >
                    <Video className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                      {a.display_name || a.file_name || 'Untitled video'}
                      {a.player_index !== null && (
                        <span className="font-normal text-[var(--marketing-white)]/60">
                          {` — Player ${a.player_index}`}
                        </span>
                      )}
                    </span>
                    {score !== null && (
                      <span className="shrink-0 text-[13px] font-semibold text-[var(--marketing-white)]">
                        {score}
                      </span>
                    )}
                    <Badge variant={a.complete ? 'success' : a.error_code ? 'danger' : 'secondary'}>
                      {a.complete ? 'Done' : a.error_code ? 'Failed' : 'Running'}
                    </Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Upcoming events</h2>
          <Link
            href="/dashboard/schedule"
            className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]"
          >
            Schedule
          </Link>
        </div>
        {!upcomingEvents || upcomingEvents.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            {upcomingEvents === null
              ? 'Events failed to load.'
              : 'No upcoming events in the next 30 days.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {upcomingEvents.map((e) => (
              <li key={e.id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href="/dashboard/schedule"
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <CalendarIcon className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {e.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--marketing-white)]/60">
                    <ClockIcon className="size-3" />
                    {new Date(e.starts_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Recent reports</h2>
          <Link
            href="/dashboard/reports"
            className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]"
          >
            All reports
          </Link>
        </div>
        {!recentReports || recentReports.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            No reports generated yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {recentReports.map((r) => (
              <li key={r.id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href={`/dashboard/reports/${r.id}`}
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <FileTextIcon className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--marketing-white)]/60">
                    {r.full_name || 'Organization'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showOrgSection && tiles.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-[13px] font-semibold text-[var(--marketing-white)]">Organization</h2>
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {tiles.map((t) => (
              <li key={t.label} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href={t.href}
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <t.icon className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {t.label}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-[var(--marketing-white)]">
                    {t.value}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!overview && !error && (
        <p className="mt-6 rounded-xl border border-[var(--marketing-white)]/10 glass-panel p-6 text-center text-sm text-[var(--marketing-white)]/60">
          No organization data yet — add students to get started.
        </p>
      )}
    </div>
  )
}

// Player-scoped fields are a subset of the coach history row — the self-scoped
// /api/me/analyses endpoint omits file_name/error_code, so those stay optional.
type PlayerAnalysisRow = DashboardPlayerAnalysis & {
  file_name?: string | null
  error_code?: string | null
}

type PlayerObjective = MyObjectives['objectives'][number]

function formatDueOn(dueOn: string | null): string {
  if (!dueOn) return 'No due date'
  const parsed = new Date(dueOn)
  if (Number.isNaN(parsed.getTime())) return `Due ${dueOn}`
  return `Due ${parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })}`
}

// ── Personal home for players (org role) ───────────────────────────────────
// Self-scoped data only (via lib/serverData getMy* fetchers hitting /api/me/*).
// Each source fails independently — one null source renders its own empty
// state instead of breaking the page. Player detail lives in the hub, so every
// row links to /player.
async function PlayerHome() {
  const [analysesRes, scheduleRes, reportsRes, objectivesRes] = await Promise.all([
    getMyAnalyses().catch(() => null),
    getMySchedule().catch(() => null),
    getMyReports().catch(() => null),
    getMyObjectives().catch(() => null),
  ])

  const analyses: PlayerAnalysisRow[] | null = analysesRes ? analysesRes.analyses : null
  const now = new Date()
  const upcoming: ScheduleEvent[] | null = scheduleRes
    ? scheduleRes.events
        .filter((e) => e.status === 'scheduled' && new Date(e.starts_at).getTime() >= now.getTime())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 5)
    : null
  const objectives: PlayerObjective[] | null = objectivesRes
    ? objectivesRes.objectives.filter((o) => o.status === 'active')
    : null
  const reports: ReportRecord[] | null = reportsRes ? reportsRes.reports.slice(0, 4) : null

  const loaded = analyses !== null || upcoming !== null || objectives !== null || reports !== null
  const statCards = loaded
    ? [
        { label: 'My Analyses', value: analyses?.length ?? 0 },
        { label: 'Active Objectives', value: objectives?.length ?? 0 },
        { label: 'Reports', value: reportsRes?.reports.length ?? 0 },
      ]
    : []

  return (
    <div className="mx-auto max-w-[760px] px-6 py-8">
      <h1 className="text-[28px] font-bold tracking-tight text-[var(--marketing-white)]">My training</h1>
      <p className="mt-1 text-sm text-[var(--marketing-white)]/60">Your analyses, schedule, and objectives.</p>

      {statCards.length > 0 && (
        <div className="mt-6 grid grid-cols-2 divide-border rounded-xl border border-[var(--marketing-white)]/10 glass-panel sm:grid-cols-3 sm:divide-x">
          {statCards.map((stat) => (
            <div key={stat.label} className="px-5 py-4">
              <p className="text-2xl font-bold tracking-tight text-[var(--marketing-white)]">{stat.value}</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-[var(--marketing-white)]/60">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">My analyses</h2>
          <Link href="/player" className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]">
            Player hub
          </Link>
        </div>
        {!analyses || analyses.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            {analyses === null ? 'Analyses failed to load.' : 'No analyses yet.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {analyses.slice(0, 5).map((a) => {
              const score =
                a.summary_json &&
                typeof a.summary_json === 'object' &&
                'form_score' in a.summary_json
                  ? (a.summary_json as { form_score: number }).form_score
                  : null
              return (
                <li key={a.server_job_id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                  <Link
                    href="/player"
                    className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                  >
                    <Video className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                      {a.display_name || a.file_name || 'Untitled video'}
                    </span>
                    {score !== null && (
                      <span className="shrink-0 text-[13px] font-semibold text-[var(--marketing-white)]">
                        {score}
                      </span>
                    )}
                    <Badge variant={a.complete ? 'success' : a.error_code ? 'danger' : 'secondary'}>
                      {a.complete ? 'Done' : a.error_code ? 'Failed' : 'Running'}
                    </Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Up next</h2>
          <Link href="/player" className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]">
            Player hub
          </Link>
        </div>
        {!upcoming || upcoming.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            {upcoming === null ? 'Schedule failed to load.' : 'Nothing scheduled.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {upcoming.map((e) => (
              <li key={e.id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href="/player"
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <CalendarIcon className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {e.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--marketing-white)]/60">
                    <ClockIcon className="size-3" />
                    {new Date(e.starts_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Objectives</h2>
          <Link href="/player" className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]">
            Player hub
          </Link>
        </div>
        {!objectives || objectives.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            {objectives === null ? 'Objectives failed to load.' : 'No active objectives.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {objectives.slice(0, 5).map((o) => (
              <li key={o.id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href="/player"
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <ClipboardCheck className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {o.title}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--marketing-white)]/60">
                    {formatDueOn(o.due_on)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--marketing-white)]">Reports</h2>
          <Link href="/player" className="text-xs text-[var(--marketing-white)]/60 hover:text-[var(--marketing-white)]">
            Player hub
          </Link>
        </div>
        {!reports || reports.length === 0 ? (
          <p className="rounded-xl border border-[var(--marketing-white)]/10 glass-panel px-4 py-6 text-center text-[13px] text-[var(--marketing-white)]/60">
            {reports === null ? 'Reports failed to load.' : 'No reports yet.'}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--marketing-white)]/10 glass-panel">
            {reports.map((r) => (
              <li key={r.id} className="border-b border-[var(--marketing-white)]/10 last:border-0">
                <Link
                  href="/player"
                  className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/10"
                >
                  <FileTextIcon className="size-4 shrink-0 text-[var(--marketing-white)]/60" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--marketing-white)]">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--marketing-white)]/60">
                    {new Date(r.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
