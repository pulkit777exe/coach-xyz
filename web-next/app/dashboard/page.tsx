import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'

import CoachHome from '@/components/dashboard/CoachHome'
import OwnerHome from '@/components/dashboard/OwnerHome'
import PlayerHome from '@/components/dashboard/PlayerHome'
import type { DashboardAnalysis, DashboardStats } from '@/lib/library'
import type { OrgMembersResponse } from '@/lib/members'
import type { OrgOverview, ReportRecord, ScheduleEvent } from '@/lib/org/types'
import type { OrgSubscription } from '@/lib/org/subscription'
import {
  getDashboardAnalyses,
  getDashboardStats,
  getOrgContext,
  orgMembers,
  orgOverview,
  orgReports,
  orgSchedule,
  orgSubscription,
  orgTeams,
} from '@/lib/serverData'
import { getSession } from '@/lib/session'
import { HISTORY_NAV_ROLES } from '@/lib/nav'
import { AUTH_USER_ALLOWED_MEMBER_ROLES, dashboardQuickActions } from '@/lib/permissions'
import type { Team } from '@/lib/teams'

export const metadata: Metadata = {
  title: 'Dashboard | CoachXYZ',
  description: 'Overview of your organization, analyses, and activity.',
}

export default async function DashboardPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx

  if (role === 'player') {
    return <PlayerHome />
  }

  const isOwner = role === 'owner' || (role as string) === 'admin'
  const showHistoryLink = HISTORY_NAV_ROLES.includes(role)
  const quickActions = dashboardQuickActions(role)
  const canReadAccountData = AUTH_USER_ALLOWED_MEMBER_ROLES.includes(role)
  const displayName = session.user.name ?? session.user.email ?? ''
  const firstName = displayName.split('@')[0].split(' ')[0] || 'there'

  let stats: DashboardStats | null = null
  let analyses: DashboardAnalysis[] | null = null
  let events: ScheduleEvent[] | null = null
  let reports: ReportRecord[] | null = null
  let overview: OrgOverview | null = null
  let teams: Team[] | null = null
  let members: OrgMembersResponse | null = null
  let subscription: OrgSubscription | null = null
  let subscriptionFailed = false
  let error: string | null = null

  try {
    const now = new Date()
    const inThirtyDays = new Date()
    inThirtyDays.setDate(inThirtyDays.getDate() + 30)
    const [
      statsRes,
      analysesRes,
      scheduleRes,
      reportsRes,
      overviewRes,
      teamsRes,
      membersRes,
      subscriptionRes,
    ] = await Promise.all([
      canReadAccountData ? getDashboardStats(auth0Id) : Promise.resolve({ stats: null }),
      canReadAccountData
        ? getDashboardAnalyses(auth0Id, 20, 0)
        : Promise.resolve({ analyses: null }),
      orgSchedule(auth0Id, { from: now.toISOString(), to: inThirtyDays.toISOString() }),
      orgReports(auth0Id),
      orgOverview(auth0Id),
      orgTeams(auth0Id).catch(() => null),
      isOwner ? orgMembers(auth0Id).catch(() => null) : Promise.resolve(null),
      isOwner
        ? orgSubscription(auth0Id).catch(() => {
            subscriptionFailed = true
            return null
          })
        : Promise.resolve(null),
    ])
    stats = statsRes.stats
    analyses = analysesRes.analyses
    events = scheduleRes.events
      .filter((e) => e.status === 'scheduled' && new Date(e.starts_at).getTime() >= now.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5)
    reports = reportsRes.reports
    overview = overviewRes.overview
    teams = teamsRes !== null ? teamsRes.teams : null
    members = membersRes
    subscription = subscriptionRes
  } catch (err) {
    console.error('Failed to load dashboard data:', err)
    error = err instanceof Error ? err.message : 'Failed to load dashboard data'
  }

  if (isOwner) {
    return (
      <OwnerHome
        firstName={firstName}
        error={error}
        stats={stats}
        analyses={analyses}
        events={events}
        reports={reports}
        overview={overview}
        members={members}
        subscription={subscription}
        subscriptionFailed={subscriptionFailed}
        showHistoryLink={showHistoryLink}
        quickActions={quickActions}
      />
    )
  }

  return (
    <CoachHome
      firstName={firstName}
      error={error}
      stats={stats}
      analyses={analyses}
      events={events}
      reports={reports}
      overview={overview}
      teams={teams}
      role={role}
      showHistoryLink={showHistoryLink}
      quickActions={quickActions}
    />
  )
}
