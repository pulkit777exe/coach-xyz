import Link from 'next/link'
import { CalendarDays, ChevronRight, ClipboardCheck, Shield, Users } from 'lucide-react'

import {
  EmptyCard,
  ErrorBanner,
  GreetingHeader,
  ListRow,
  ListShell,
  QuickActions,
  RecentList,
  ReportsList,
  SectionHeading,
  StatTiles,
  UpcomingList,
  shellClass,
} from '@/components/dashboard/OwnerHome'
import type { DashboardAnalysis, DashboardStats } from '@/lib/api'
import type { DashboardQuickActions } from '@/lib/permissions'
import type { OrgOverview, ReportRecord, ScheduleEvent } from '@/lib/org'
import type { OrgRole } from '@/lib/serverData'
import type { Team } from '@/lib/teams'

/** Today's org-admin surfaces: organization counts stay with these four. */
function showsOrgSection(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'head_coach' || role === 'coach'
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

function OrgSection({ overview }: { overview: OrgOverview }) {
  const tiles = overviewTiles(overview)
  return (
    <section className="mt-8">
      <div className="mb-1">
        <h2 className="text-[13px] font-semibold leading-[1.4] text-foreground">Organization</h2>
      </div>
      <ListShell>
        {tiles.map((tile) => (
          <ListRow
            key={tile.label}
            href={tile.href}
            icon={<tile.icon className="size-4" />}
            label={tile.label}
            meta={tile.value}
          />
        ))}
      </ListShell>
    </section>
  )
}

function TeamsCard({ teams }: { teams: Team[] | null }) {
  const rows = teams !== null ? teams.slice(0, 5) : []
  return (
    <section className="mt-8">
      <SectionHeading title="Teams" href="/dashboard/teams" linkLabel="All teams" />
      {teams === null ? (
        <EmptyCard>Teams failed to load.</EmptyCard>
      ) : rows.length === 0 ? (
        <p className="rounded-[6px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          No teams yet.{' '}
          <Link
            href="/dashboard/teams"
            className="text-primary transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Manage teams →
          </Link>
        </p>
      ) : (
        <ListShell>
          {rows.map((team) => (
            <ListRow
              key={team.id}
              href="/dashboard/teams"
              icon={<Shield className="size-4" />}
              label={team.name}
              meta={team.sport ?? undefined}
              trailing={<ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            />
          ))}
        </ListShell>
      )}
    </section>
  )
}

// ── Coach/staff home — training operations focus ────────────────────────────

export default function CoachHome({
  firstName,
  error,
  stats,
  analyses,
  events,
  reports,
  overview,
  teams,
  role,
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
  teams: Team[] | null
  role: OrgRole
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

  return (
    <div className={shellClass}>
      <GreetingHeader firstName={firstName} />
      <ErrorBanner show={error !== null} />

      {statCards.length > 0 ? <StatTiles tiles={statCards} /> : null}

      {/* No invite tile here — inviting is owner/admin-only. */}
      <QuickActions {...quickActions} />

      <TeamsCard teams={teams} />

      {showsOrgSection(role) && overview !== null ? (
        <OrgSection overview={overview} />
      ) : null}

      {!overview && !error ? (
        <p className="mt-6 rounded-[6px] border border-border bg-card p-6 text-center text-[14px] text-muted-foreground">
          No organization data yet — add students to get started.
        </p>
      ) : null}

      <RecentList analyses={analyses} limit={10} showHistoryLink={showHistoryLink} />
      <UpcomingList events={events} />
      <ReportsList reports={reports} limit={4} />
    </div>
  )
}
