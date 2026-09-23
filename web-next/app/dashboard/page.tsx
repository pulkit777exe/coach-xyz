import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import {
  getOrgContext,
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
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
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
import { unstable_noStore as noStore } from 'next/cache'

import PageHeader from '@/components/org/PageHeader'
import StatusPill from '@/components/org/StatusPill'

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

// ── Shared dashboard building blocks (module level — never nested) ─────────

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-4">
      <h2 className="text-[13px] font-semibold leading-[1.4] text-foreground">{title}</h2>
      <Link
        href={href}
        className="text-[13px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
      >
        {linkLabel}
      </Link>
    </div>
  )
}

function ListShell({ children }: { children: ReactNode }) {
  return <ul className="space-y-0.5 py-0.5">{children}</ul>
}

function ListRow({
  href,
  icon,
  label,
  meta,
  trailing,
}: {
  href: string
  icon: ReactNode
  label: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex h-10 items-center gap-2.5 rounded-[4px] px-2 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.4] text-foreground">
          {label}
        </span>
        {meta ? (
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{meta}</span>
        ) : null}
        {trailing}
      </Link>
    </li>
  )
}

function StatTiles({ tiles }: { tiles: { label: string; value: number | string }[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((stat) => (
        <div
          key={stat.label}
          className="rounded-[6px] border border-border bg-card px-5 py-4"
        >
          <p className="text-[11px] font-medium uppercase leading-[1.3] tracking-[0.08em] text-muted-foreground">
            {stat.label}
          </p>
          <p className="mt-1.5 text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums text-foreground">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[6px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  )
}

const rowLinkClass =
  'flex h-10 items-center gap-2.5 rounded-[4px] px-2 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

const shellClass = 'mx-auto max-w-[1080px] px-6 py-6 lg:px-8'

export default async function DashboardPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = await getOrgContext()

  // ── Personal view for players (org role) ───────────────────────────────
  // Players see only their own data via the self-scoped /api/me/* APIs —
  // never the org roster, stats, or admin surfaces.
  if (role === 'player') {
    return <PlayerHome />
  }

  const canInvite = role === 'owner' || role === 'admin'
  // Scoped staff (assistant/analyst/medical) get the coaching workspace
  // without org-admin surfaces (invites, organization counts).
  const showOrgSection =
    role === 'owner' || role === 'admin' || role === 'head_coach' || role === 'coach'

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
    const [statsRes, analysesRes, scheduleRes, reportsRes, overviewRes] = await Promise.all([
      getDashboardStats(auth0Id),
      getDashboardAnalyses(auth0Id, 20, 0),
      orgSchedule(auth0Id, { from: now.toISOString(), to: inThirtyDays.toISOString() }),
      orgReports(auth0Id),
      orgOverview(auth0Id),
    ])
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
    <div className={shellClass}>
      <PageHeader title="Home" description="Your coaching organization at a glance." />

      {error ? (
        <div className="mb-2 rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
          Failed to load dashboard data. Please try again later.
        </div>
      ) : null}

      {statCards.length > 0 && <StatTiles tiles={statCards} />}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href="/#analyze"
          className="flex h-10 items-center gap-2.5 rounded-[6px] border border-border bg-card px-4 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Plus className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[14px] leading-[1.4] text-foreground">New analysis</span>
        </Link>
        <Link
          href="/dashboard/students"
          className="flex h-10 items-center gap-2.5 rounded-[6px] border border-border bg-card px-4 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Users className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[14px] leading-[1.4] text-foreground">Add student</span>
        </Link>
        <Link
          href="/dashboard/schedule"
          className="flex h-10 items-center gap-2.5 rounded-[6px] border border-border bg-card px-4 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[14px] leading-[1.4] text-foreground">Schedule event</span>
        </Link>
        {canInvite && (
          <Link
            href="/dashboard/members"
            className="flex h-10 items-center gap-2.5 rounded-[6px] border border-border bg-card px-4 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <UserPlus className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-[14px] leading-[1.4] text-foreground">Invite member</span>
          </Link>
        )}
      </div>

      <section className="mt-8">
        <SectionHeading title="Recents" href="/dashboard/history" linkLabel="View all" />
        {!analyses || analyses.length === 0 ? (
          <EmptyCard>No analyses yet — run your first one above.</EmptyCard>
        ) : (
          <ListShell>
            {analyses.slice(0, 5).map((a) => {
              const score =
                a.summary_json &&
                typeof a.summary_json === 'object' &&
                'form_score' in a.summary_json
                  ? (a.summary_json as { form_score: number }).form_score
                  : null
              return (
                <ListRow
                  key={a.server_job_id}
                  href={`/dashboard/analysis/${a.server_job_id}`}
                  icon={<Video className="size-4" />}
                  label={
                    <>
                      {a.display_name || a.file_name || 'Untitled video'}
                      {a.player_index !== null && (
                        <span className="text-muted-foreground">{` — Player ${a.player_index}`}</span>
                      )}
                    </>
                  }
                  meta={score !== null ? score : undefined}
                  trailing={
                    <StatusPill tone={a.complete ? 'green' : a.error_code ? 'red' : 'gray'}>
                      {a.complete ? 'Done' : a.error_code ? 'Failed' : 'Running'}
                    </StatusPill>
                  }
                />
              )
            })}
          </ListShell>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading title="Upcoming events" href="/dashboard/schedule" linkLabel="Schedule" />
        {!upcomingEvents || upcomingEvents.length === 0 ? (
          <EmptyCard>
            {upcomingEvents === null
              ? 'Events failed to load.'
              : 'No upcoming events in the next 30 days.'}
          </EmptyCard>
        ) : (
          <ListShell>
            {upcomingEvents.map((e) => (
              <ListRow
                key={e.id}
                href="/dashboard/schedule"
                icon={<CalendarIcon className="size-4" />}
                label={e.title}
                meta={
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="size-3" />
                    {new Date(e.starts_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                }
              />
            ))}
          </ListShell>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading title="Recent reports" href="/dashboard/reports" linkLabel="All reports" />
        {!recentReports || recentReports.length === 0 ? (
          <EmptyCard>No reports generated yet.</EmptyCard>
        ) : (
          <ListShell>
            {recentReports.map((r) => (
              <ListRow
                key={r.id}
                href={`/dashboard/reports/${r.id}`}
                icon={<FileTextIcon className="size-4" />}
                label={r.title}
                meta={r.full_name || 'Organization'}
              />
            ))}
          </ListShell>
        )}
      </section>

      {showOrgSection && tiles.length > 0 && (
        <section className="mt-8">
          <div className="mb-1">
            <h2 className="text-[13px] font-semibold leading-[1.4] text-foreground">
              Organization
            </h2>
          </div>
          <ListShell>
            {tiles.map((t) => (
              <ListRow
                key={t.label}
                href={t.href}
                icon={<t.icon className="size-4" />}
                label={t.label}
                meta={t.value}
              />
            ))}
          </ListShell>
        </section>
      )}
      {!overview && !error && (
        <p className="mt-6 rounded-[6px] border border-border bg-card p-6 text-center text-[14px] text-muted-foreground">
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
    <div className={shellClass}>
      <PageHeader title="My training" description="Your analyses, schedule, and objectives." />

      {statCards.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {statCards.map((stat) => (
            <div key={stat.label} className="rounded-[6px] border border-border bg-card px-5 py-4">
              <p className="text-[11px] font-medium uppercase leading-[1.3] tracking-[0.08em] text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-1.5 text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums text-foreground">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <section className="mt-8">
        <SectionHeading title="My analyses" href="/player" linkLabel="Player hub" />
        {!analyses || analyses.length === 0 ? (
          <EmptyCard>{analyses === null ? 'Analyses failed to load.' : 'No analyses yet.'}</EmptyCard>
        ) : (
          <ListShell>
            {analyses.slice(0, 5).map((a) => {
              const score =
                a.summary_json &&
                typeof a.summary_json === 'object' &&
                'form_score' in a.summary_json
                  ? (a.summary_json as { form_score: number }).form_score
                  : null
              return (
                <ListRow
                  key={a.server_job_id}
                  href="/player"
                  icon={<Video className="size-4" />}
                  label={a.display_name || a.file_name || 'Untitled video'}
                  meta={score !== null ? score : undefined}
                  trailing={
                    <StatusPill tone={a.complete ? 'green' : a.error_code ? 'red' : 'gray'}>
                      {a.complete ? 'Done' : a.error_code ? 'Failed' : 'Running'}
                    </StatusPill>
                  }
                />
              )
            })}
          </ListShell>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading title="Up next" href="/player" linkLabel="Player hub" />
        {!upcoming || upcoming.length === 0 ? (
          <EmptyCard>{upcoming === null ? 'Schedule failed to load.' : 'Nothing scheduled.'}</EmptyCard>
        ) : (
          <ListShell>
            {upcoming.map((e) => (
              <ListRow
                key={e.id}
                href="/player"
                icon={<CalendarIcon className="size-4" />}
                label={e.title}
                meta={
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="size-3" />
                    {new Date(e.starts_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                }
              />
            ))}
          </ListShell>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading title="Objectives" href="/player" linkLabel="Player hub" />
        {!objectives || objectives.length === 0 ? (
          <EmptyCard>
            {objectives === null ? 'Objectives failed to load.' : 'No active objectives.'}
          </EmptyCard>
        ) : (
          <ListShell>
            {objectives.slice(0, 5).map((o) => (
              <ListRow
                key={o.id}
                href="/player"
                icon={<ClipboardCheck className="size-4" />}
                label={o.title}
                meta={formatDueOn(o.due_on)}
              />
            ))}
          </ListShell>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading title="Reports" href="/player" linkLabel="Player hub" />
        {!reports || reports.length === 0 ? (
          <EmptyCard>{reports === null ? 'Reports failed to load.' : 'No reports yet.'}</EmptyCard>
        ) : (
          <ListShell>
            {reports.map((r) => (
              <ListRow
                key={r.id}
                href="/player"
                icon={<FileTextIcon className="size-4" />}
                label={r.title}
                meta={new Date(r.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              />
            ))}
          </ListShell>
        )}
      </section>
    </div>
  )
}
