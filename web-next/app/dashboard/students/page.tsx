import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgStudents, orgStudentsSports, orgTeams } from '@/lib/serverData'
import StudentsClient from '@/components/org/StudentsClient'
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
    orgStudents(auth0Id),
    orgStudentsSports(auth0Id),
    orgTeams(auth0Id),
  ])

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground">Students</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Students</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your roster, attendance, and notes.
      </p>

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
