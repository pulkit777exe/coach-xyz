import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgStudents, orgStudentsSports, orgTeams } from '@/lib/serverData'
import StudentsClient from '@/components/org/StudentsClient'
import PageHeader from '@/components/org/PageHeader'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Students | CoachXYZ',
  description: 'Manage your roster, attendance, and notes.',
}

export default async function StudentsPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const { auth0Id } = await getOrgContext()

  const [studentsRes, sportsRes, teamsRes] = await Promise.all([
    orgStudents(auth0Id).catch(() => ({ students: [] })),
    orgStudentsSports(auth0Id).catch(() => ({ sports: [] })),
    orgTeams(auth0Id).catch(() => ({ teams: [] })),
  ])

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Students']}
        title="Students"
        description="Manage your roster, attendance, and notes."
      />

      <div className="mt-6">
        <StudentsClient
          auth0Id={auth0Id}
          initialStudents={studentsRes.students}
          sports={sportsRes.sports}
          teams={teamsRes.teams}
        />
      </div>
    </div>
  )
}
