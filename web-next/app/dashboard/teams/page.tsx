import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgSeasons, orgStudents, orgTeams } from '@/lib/serverData'
import TeamsClient from '@/components/org/TeamsClient'
import PageHeader from '@/components/org/PageHeader'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Teams | CoachXYZ',
  description: 'Organize your roster into teams for scoped coaching and trends.',
}

export default async function TeamsPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const { auth0Id } = await getOrgContext()

  const [teamsRes, studentsRes, seasonsRes] = await Promise.all([
    orgTeams(auth0Id).catch(() => ({ teams: [] })),
    orgStudents(auth0Id).catch(() => ({ students: [] })),
    orgSeasons(auth0Id).catch(() => ({ seasons: [] })),
  ])

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
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
