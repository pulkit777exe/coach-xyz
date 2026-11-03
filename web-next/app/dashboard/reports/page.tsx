import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgReports, orgStudents } from '@/lib/serverData'
import ReportsClient from '@/components/org/ReportsClient'
import PageHeader from '@/components/org/PageHeader'
import { hasPermission, REPORT_SEND_ROLES } from '@/lib/permissions'
import { connection } from 'next/server'

export const metadata: Metadata = {
  title: 'Reports | CoachXYZ',
  description: 'AI-assisted player evaluation reports.',
}

export default async function ReportsPage() {
  await connection()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx

  const [reportsRes, studentsRes] = await Promise.all([orgReports(auth0Id), orgStudents(auth0Id)])

  return (
    <div className="bg-grid relative mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Reports']}
        title="Reports"
        description="AI-assisted player evaluations and exports."
      />
      <div className="mt-6">
        <ReportsClient
          auth0Id={auth0Id}
          initialReports={reportsRes.reports}
          students={studentsRes.students}
          canWrite={hasPermission(role, 'report.create')}
          canSend={REPORT_SEND_ROLES.includes(role)}
        />
      </div>
    </div>
  )
}
