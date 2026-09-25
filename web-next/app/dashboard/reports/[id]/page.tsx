import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgReport } from '@/lib/serverData'
import { REPORT_TYPE_LABELS } from '@/lib/org'
import type { ReportType } from '@/lib/org'
import { formatDateMed } from '@/lib/date'
import { unstable_noStore as noStore } from 'next/cache'
import ReportBody from '@/components/org/ReportBody'
import PrintReportButton from '@/components/org/PrintReportButton'
import PageHeader from '@/components/org/PageHeader'

export function generateMetadata(): Metadata {
  return { title: 'Report | CoachXYZ', description: 'Generated coach report.' }
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
        trail={['Reports', report.title || 'Untitled']}
        title={report.title || 'Untitled'}
        description={`${report.full_name || 'Organization'} · ${
          REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type
        } · ${
          report.period_start
            ? `${formatDateMed(report.period_start)} → ${formatDateMed(report.period_end ?? report.period_start)}`
            : 'All time'
        }`}
        actions={<PrintReportButton />}
      />

      <div className="mt-6">
        <ReportBody report={report} showGenerated />
      </div>

      <style>{`@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
    </div>
  )
}
