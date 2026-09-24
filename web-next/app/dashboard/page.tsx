import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'

import CoachHome from '@/components/dashboard/CoachHome'
import OwnerHome from '@/components/dashboard/OwnerHome'
import PlayerHome from '@/components/dashboard/PlayerHome'
import type { DashboardAnalysis, DashboardStats } from '@/lib/api'
import type { OrgMembersResponse } from '@/lib/members'
import type { OrgOverview, OrgSubscription, ReportRecord, ScheduleEvent } from '@/lib/org'
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

/**
 * Role-branched home. The ORG role (not the account role — that only steers
 * the /dashboard vs /player layout redirect) decides which dashboard renders:
 * owner/admin → org health + plan + staff preview; every other staff role →
 * training operations (teams, org ops, feeds); org players → the real
 * self-scoped PlayerHub. This page owns the session gate, `noStore()` and all
 * fetching; the three components are pure server-rendered views.
 */
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

  const isOwnerAdmin = role === 'owner' || role === 'admin'
  // Recents "View all" links to History — only for roles that may open it.
  const showHistoryLink = HISTORY_NAV_ROLES.includes(role)
  // Action tiles mirror each destination's write floors (lib/permissions).
  const quickActions = dashboardQuickActions(role)
  // Stats + analyses live under the self-scoped /api/auth/user/:id/* tree; the
  // server floors cross-account reads to AUTH_USER_ALLOWED_MEMBER_ROLES
  // (server/src/lib/serviceGuard.ts) — medical is excluded by design, and its
  // permission matrix already denies analysis.read (lib/permissions.ts). Skip
  // both fetches outside the floor: a single 403 would reject the Promise.all
  // and null every widget on the landing.
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
      // Teams/members/subscription degrade to null rather than failing the page —
      // members + subscription are owner/admin-only server-side.
      orgTeams(auth0Id).catch(() => null),
      isOwnerAdmin ? orgMembers(auth0Id).catch(() => null) : Promise.resolve(null),
      isOwnerAdmin ? orgSubscription(auth0Id).catch(() => null) : Promise.resolve(null),
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

  if (isOwnerAdmin) {
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
