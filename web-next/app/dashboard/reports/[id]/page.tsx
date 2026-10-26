import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import { getOrgContext, orgReport } from '@/lib/serverData'
import ReportDetailClient from '@/components/org/ReportDetailClient'
import PageHeader from '@/components/org/PageHeader'
import { unstable_noStore as noStore } from 'next/cache'

export function generateMetadata(): Metadata {
  return {
    title: 'Report Detail | CoachXYZ',
    description: 'Player evaluation report.',
  }
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id } = orgCtx
  const { id } = await params

  const { report } = await orgReport(auth0Id, id).catch(() => ({ report: null }))
  if (!report) notFound()

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Reports', report.title]}
        title={report.title}
        description={`Created ${new Date(report.created_at).toLocaleDateString()}`}
      />
      <div className="mt-6">
        <ReportDetailClient auth0Id={auth0Id} initialReport={report} />
      </div>
    </div>
  )
}
