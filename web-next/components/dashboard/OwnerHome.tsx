import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  CalendarIcon,
  ClockIcon,
  FileTextIcon,
  Plus,
  UserPlus,
  Users,
  Video,
} from 'lucide-react'

import StatusPill from '@/components/org/StatusPill'
import type { DashboardAnalysis, DashboardStats } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ORG_MEMBER_ROLE_LABELS, type OrgMembersResponse } from '@/lib/members'
import type { OrgOverview, OrgSubscription, ReportRecord, ScheduleEvent } from '@/lib/org'
import type { DashboardQuickActions } from '@/lib/permissions'

export const shellClass = 'mx-auto max-w-[1080px] px-6 py-6 lg:px-8'

const rowLinkClass =
  'flex h-9 items-center gap-2.5 rounded-[4px] px-2 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

const cardClass = 'rounded-[6px] border border-border bg-card p-5'

const metricLabelClass =
  'text-[11px] font-medium uppercase leading-[1.3] tracking-[0.08em] text-muted-foreground'

const headingClass = 'text-[13px] font-semibold leading-[1.4] text-foreground'

const linkFocusClass =
  'transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

// ── Greeting ────────────────────────────────────────────────────────────────

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function GreetingHeader({ firstName }: { firstName: string }) {
  const now = new Date()
  const dateLine = now.toLocaleDateString('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return (
    <header className="mb-7">
      <h1 className="text-[30px] font-bold leading-[1.2] tracking-[-0.015em] text-foreground">
        {greeting(now)}, {firstName}.
      </h1>
      <p className="mt-1.5 text-[14px] leading-[1.5] tabular-nums text-muted-foreground">
        {dateLine}
      </p>
    </header>
  )
}

// ── Shared dashboard building blocks (module level — never nested) ─────────

export function ErrorBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="mb-2 rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
      Failed to load dashboard data. Please try again later.
    </div>
  )
}

export function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string
  /** When either is omitted the heading renders without its "View all"-style link. */
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-4">
      <h2 className={headingClass}>{title}</h2>
      {href && linkLabel ? (
        <Link
          href={href}
          className={`text-[13px] text-muted-foreground ${linkFocusClass}`}
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  )
}

export function ListShell({ children }: { children: ReactNode }) {
  return <ul className="space-y-0.5 py-0.5">{children}</ul>
}

export function ListRow({
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
      <Link href={href} className={rowLinkClass}>
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

export function StatTiles({
  tiles,
}: {
  tiles: { label: string; value: number | string; meta?: string }[]
}) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((stat) => (
        <div key={stat.label} className="rounded-[6px] border border-border bg-card px-5 py-4">
          <p className={metricLabelClass}>{stat.label}</p>
          <p className="mt-1.5 text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums text-foreground">
            {stat.value}
          </p>
          {stat.meta ? (
            <p className="mt-1 text-[12px] text-muted-foreground">{stat.meta}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[6px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  )
}

function ActionTile({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: React.ElementType
  label: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-[6px] border border-border bg-card p-4 transition-colors duration-150 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  )
}

export function QuickActions({
  analyze,
  manageStudents,
  schedule,
  invite,
}: DashboardQuickActions) {
  const tiles = [
    ...(analyze ? [{ href: '/#analyze', icon: Plus, label: 'New analysis' }] : []),
    ...(manageStudents
      ? [{ href: '/dashboard/students', icon: Users, label: 'Add student' }]
      : []),
    ...(schedule
      ? [{ href: '/dashboard/schedule', icon: CalendarDays, label: 'Schedule event' }]
      : []),
    ...(invite ? [{ href: '/dashboard/members', icon: UserPlus, label: 'Invite member' }] : []),
  ]
  if (tiles.length === 0) return null
  const grid =
    tiles.length >= 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : tiles.length === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : tiles.length === 2
          ? 'sm:grid-cols-2'
          : ''
  return (
    <div className={cn('mt-4 grid gap-2', grid)}>
      {tiles.map((tile) => (
        <ActionTile key={tile.href} {...tile} />
      ))}
    </div>
  )
}

// ── Shared feed rows (defined once, reused by CoachHome) ────────────────────

function formScore(summary: unknown): number | null {
  if (summary && typeof summary === 'object' && 'form_score' in summary) {
    const value = (summary as { form_score: unknown }).form_score
    return typeof value === 'number' ? value : null
  }
  return null
}

export function RecentList({
  analyses,
  limit,
  showHistoryLink,
}: {
  analyses: DashboardAnalysis[] | null
  limit: number
  /** False for roles outside HISTORY_NAV_ROLES (no analysis.read → no History link). */
  showHistoryLink: boolean
}) {
  const rows = (analyses ?? []).slice(0, limit)
  return (
    <section className="mt-8">
      <SectionHeading
        title="Recents"
        href={showHistoryLink ? '/dashboard/history' : undefined}
        linkLabel={showHistoryLink ? 'View all' : undefined}
      />
      {analyses === null || analyses.length === 0 ? (
        <EmptyCard>No analyses yet — run your first one above.</EmptyCard>
      ) : (
        <ListShell>
          {rows.map((a) => {
            const score = formScore(a.summary_json)
            return (
              <ListRow
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                icon={<Video className="size-4" />}
                label={
                  <>
                    {a.display_name || a.file_name || 'Untitled video'}
                    {a.player_index !== null ? (
                      <span className="text-muted-foreground">{` — Player ${a.player_index}`}</span>
                    ) : null}
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
  )
}

export function UpcomingList({ events }: { events: ScheduleEvent[] | null }) {
  return (
    <section className="mt-8">
      <SectionHeading title="Upcoming events" href="/dashboard/schedule" linkLabel="Schedule" />
      {events === null || events.length === 0 ? (
        <EmptyCard>
          {events === null
            ? 'Events failed to load.'
            : 'No upcoming events in the next 30 days.'}
        </EmptyCard>
      ) : (
        <ListShell>
          {events.map((e) => (
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
  )
}

export function ReportsList({
  reports,
  limit,
}: {
  reports: ReportRecord[] | null
  limit: number
}) {
  const rows = (reports ?? []).slice(0, limit)
  return (
    <section className="mt-8">
      <SectionHeading title="Recent reports" href="/dashboard/reports" linkLabel="All reports" />
      {reports === null || reports.length === 0 ? (
        <EmptyCard>No reports generated yet.</EmptyCard>
      ) : (
        <ListShell>
          {rows.map((r) => (
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
  )
}

// ── Owner-only cards ────────────────────────────────────────────────────────

function healthMetrics(overview: OrgOverview, staffCount: number | null) {
  return [
    { label: 'Students', value: overview.student_count },
    {
      label: 'Attendance',
      value:
        overview.avg_attendance_rate !== null
          ? `${Math.round(overview.avg_attendance_rate)}%`
          : '—',
    },
    { label: 'Upcoming events', value: overview.upcoming_events },
    { label: 'Sessions this month', value: overview.sessions_this_month },
    { label: 'Staff', value: staffCount !== null ? staffCount : '—' },
  ]
}

function HealthCard({
  overview,
  staffCount,
}: {
  overview: OrgOverview | null
  staffCount: number | null
}) {
  const metrics = overview !== null ? healthMetrics(overview, staffCount) : []
  return (
    <section className={cardClass}>
      <h2 className={headingClass}>Organization health</h2>
      {metrics.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <p className={metricLabelClass}>{metric.label}</p>
              <p className="mt-1 text-[20px] font-semibold leading-[1.2] tabular-nums text-foreground">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          No organization data yet — add students to get started.
        </p>
      )}
    </section>
  )
}

function PlanCard({ subscription }: { subscription: OrgSubscription | null }) {
  const used = subscription !== null ? (subscription.usage_today.analysis ?? 0) : 0
  const limit = subscription !== null ? subscription.daily_analysis_limit : 0
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={headingClass}>Plan &amp; usage</h2>
        {subscription !== null ? (
          <StatusPill tone="primary">{subscription.subscription.tier}</StatusPill>
        ) : null}
      </div>
      {subscription !== null ? (
        <>
          <p className={`mt-4 ${metricLabelClass}`}>Analyses today</p>
          <p className="mt-1 text-[20px] font-semibold leading-[1.2] tabular-nums text-foreground">
            {used} / {limit}
          </p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">Plan details are visible to owners.</p>
      )}
    </section>
  )
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.charAt(0) ?? ''
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : ''
  return `${first}${last}`.toUpperCase() || '?'
}

function StaffPreview({ members }: { members: OrgMembersResponse | null }) {
  const rows = members !== null ? members.members.slice(0, 5) : []
  return (
    <section className="mt-8">
      <SectionHeading
        title="Staff"
        href="/dashboard/members"
        linkLabel="Manage members →"
      />
      {rows.length > 0 ? (
        <ListShell>
          {rows.map((member) => {
            const name = member.display_name ?? member.member_email ?? 'Member'
            const email = member.member_email
            return (
              <li key={member.id} className="flex h-9 items-center gap-2.5 px-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-[4px] bg-muted text-[11px] font-medium text-muted-foreground">
                  {initialsOf(name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.4] text-foreground">
                  {name}
                </span>
                {email ? (
                  <span
                    className="hidden w-[220px] shrink-0 truncate text-[13px] text-muted-foreground sm:block"
                    title={email}
                  >
                    {email}
                  </span>
                ) : null}
                <StatusPill>{ORG_MEMBER_ROLE_LABELS[member.role]}</StatusPill>
              </li>
            )
          })}
        </ListShell>
      ) : (
        <EmptyCard>No staff members yet.</EmptyCard>
      )}
    </section>
  )
}

// ── Owner home — org health focus ───────────────────────────────────────────

export default function OwnerHome({
  firstName,
  error,
  stats,
  analyses,
  events,
  reports,
  overview,
  members,
  subscription,
  showHistoryLink,
  quickActions,
}: {
  firstName: string
  error: string | null
  stats: DashboardStats | null
  analyses: DashboardAnalysis[] | null
  events: ScheduleEvent[] | null
  reports: ReportRecord[] | null
  overview: OrgOverview | null
  members: OrgMembersResponse | null
  subscription: OrgSubscription | null
  showHistoryLink: boolean
  quickActions: DashboardQuickActions
}) {
  const statCards =
    stats !== null
      ? [
          { label: 'Total Analyses', value: stats.total_analyses },
          { label: 'Completed', value: stats.completed_analyses },
          { label: 'In Progress', value: stats.in_progress_analyses },
          { label: 'Downloads', value: stats.total_downloads },
        ]
      : []

  const staffCount = members !== null ? members.members.length : null

  return (
    <div className={shellClass}>
      <GreetingHeader firstName={firstName} />
      <ErrorBanner show={error !== null} />

      {statCards.length > 0 ? <StatTiles tiles={statCards} /> : null}

      {/* Row 2 — the owner's focal read: org health + plan usage. */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <HealthCard overview={overview} staffCount={staffCount} />
        <PlanCard subscription={subscription} />
      </div>

      <QuickActions {...quickActions} />

      <StaffPreview members={members} />

      <RecentList analyses={analyses} limit={6} showHistoryLink={showHistoryLink} />
      <UpcomingList events={events} />
      <ReportsList reports={reports} limit={4} />
    </div>
  )
}
