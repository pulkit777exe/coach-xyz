import type { Metadata } from 'next'
import { orgStudents, orgStudentsSports, orgTeams } from '@/lib/serverData'
import StudentsClient from '@/components/org/StudentsClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Students | CoachXYZ',
  description: 'Manage your roster, attendance, and notes.',
}

export default async function StudentsPage() {
  const { auth0Id, data } = await loadPage(
    'org',
    {
      students: ({ auth0Id }) => orgStudents(auth0Id),
      sports: ({ auth0Id }) => orgStudentsSports(auth0Id),
      teams: ({ auth0Id }) => orgTeams(auth0Id),
    },
    { students: { students: [] }, sports: { sports: [] }, teams: { teams: [] } },
  )
  const studentsRes = data.students
  const sportsRes = data.sports
  const teamsRes = data.teams

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
