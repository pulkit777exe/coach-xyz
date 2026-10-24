import type { Metadata } from 'next'
import { orgSeasons, orgStudents, orgTeams } from '@/lib/serverData'
import TeamsClient from '@/components/org/TeamsClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Teams | CoachXYZ',
  description: 'Organize your roster into teams for scoped coaching and trends.',
}

export default async function TeamsPage() {
  const { auth0Id, data } = await loadPage(
    'org',
    {
      teams: ({ auth0Id }) => orgTeams(auth0Id),
      students: ({ auth0Id }) => orgStudents(auth0Id),
      seasons: ({ auth0Id }) => orgSeasons(auth0Id),
    },
    { teams: { teams: [] }, students: { students: [] }, seasons: { seasons: [] } },
  )
  const teamsRes = data.teams
  const studentsRes = data.students
  const seasonsRes = data.seasons

  return (
    <div className="mx-auto max-w-\[1080px\] px-6 py-6 lg:px-8 bg-grid relative z-10">
      <PageHeader
        trail={['Home', 'Teams']}
        title="Teams"
        description="Organize your roster into teams for scoped coaching and trends."
      />

      <div className="mt-6">
        <TeamsClient
          auth0Id={auth0Id}
          initialTeams={teamsRes.teams}
          initialSeasons={seasonsRes.seasons}
          students={studentsRes.students}
        />
      </div>
    </div>
  )
}
