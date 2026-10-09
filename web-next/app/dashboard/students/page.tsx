import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgStudents, orgStudentsSports, orgTeams } from '@/lib/serverData'
import StudentsClient from '@/components/org/StudentsClient'
import PageHeader from '@/components/org/PageHeader'
import { hasPermission, REPORT_SEND_ROLES } from '@/lib/permissions'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Students | CoachXYZ',
  description: 'Manage your roster, attendance, and notes.',
}

export default async function StudentsPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx

  const [studentsRes, sportsRes, teamsRes] = await Promise.all([
    // `null` rather than `{ students: [] }`. The roster read and the "there is no
    // roster" answer are different facts, and collapsing them here made a coach with
    // thirty players read "No students yet" — with a live Add button — on a failed
    // fetch. `sports`/`teams` only populate the filter dropdowns, so an empty list
    // there costs a filter, not a claim about the org.
    orgStudents(auth0Id).catch(() => null),
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
          initialStudents={studentsRes?.students ?? []}
          rosterFailed={studentsRes === null}
          sports={sportsRes.sports}
          teams={teamsRes.teams}
          canManage={hasPermission(role, 'player.manage')}
          canInvite={REPORT_SEND_ROLES.includes(role)}
        />
      </div>
    </div>
  )
}
