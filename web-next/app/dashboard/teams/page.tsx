import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgSeasons, orgStudents, orgTeams } from '@/lib/serverData'
import TeamsClient from '@/components/org/TeamsClient'
import PageHeader from '@/components/org/PageHeader'
import { hasPermission, TEAM_DELETE_ROLES } from '@/lib/permissions'
import { connection } from 'next/server'

export const metadata: Metadata = {
  title: 'Teams | CoachXYZ',
  description: 'Organize your roster into teams for scoped coaching and trends.',
}

export default async function TeamsPage() {
  await connection()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx

  const [teamsRes, studentsRes, seasonsRes] = await Promise.all([
    // `null` rather than an empty list, for both lists that back a rendered claim.
    // `teams` drives "No teams yet"; `students` populates the Teams→Players picker,
    // where an empty list silently removes every player from the add-member control.
    orgTeams(auth0Id).catch(() => null),
    orgStudents(auth0Id).catch(() => null),
    // Seasons only back the inline "No seasons yet." label rather than an EmptyState,
    // but a rejected read is still not the same fact as an org with no seasons.
    orgSeasons(auth0Id).catch(() => null),
  ])

  return (
    <div className="bg-grid relative mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Teams']}
        title="Teams"
        description="Organize your roster into teams for scoped coaching and trends."
      />

      <div className="mt-6">
        <TeamsClient
          auth0Id={auth0Id}
          initialTeams={teamsRes?.teams ?? []}
          teamsFailed={teamsRes === null}
          initialSeasons={seasonsRes?.seasons ?? []}
          seasonsFailed={seasonsRes === null}
          students={studentsRes?.students ?? []}
          studentsFailed={studentsRes === null}
          canManage={hasPermission(role, 'team.manage')}
          canDeleteTeam={TEAM_DELETE_ROLES.includes(role)}
        />
      </div>
    </div>
  )
}
