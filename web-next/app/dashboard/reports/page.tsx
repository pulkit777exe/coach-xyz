import type { Metadata } from 'next'
import { orgReports, orgStudents } from '@/lib/serverData'
import ReportsClient from '@/components/org/ReportsClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Reports | CoachXYZ',
  description: 'Generate and browse progress, attendance, and performance reports.',
}

export default async function ReportsPage() {
  // Bare fan-out (no fallbacks): failures throw into error.tsx, as before.
  const { auth0Id, data } = await loadPage('org', {
    reports: ({ auth0Id }) => orgReports(auth0Id),
    students: ({ auth0Id }) => orgStudents(auth0Id),
  })
  const reportsRes = data.reports
  const studentsRes = data.students

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Reports']}
        title="Reports"
        description="Generate and browse progress, attendance, and performance reports."
      />
      <div className="mt-6">
        <ReportsClient
          auth0Id={auth0Id}
          initialReports={reportsRes.reports}
          students={studentsRes.students}
        />
      </div>
    </div>
  )
}
