import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getMyReport } from '@/lib/serverData'
import { REPORT_TYPE_LABELS } from '@/lib/org/types'
import type { ReportType } from '@/lib/org/types'
import { formatDateMed } from '@/lib/date'
import { unstable_noStore as noStore } from 'next/cache'
import ReportBody from '@/components/org/ReportBody'
import PrintReportButton from '@/components/org/PrintReportButton'
import PageHeader from '@/components/org/PageHeader'

export const metadata: Metadata = {
  title: 'Report | CoachXYZ',
  description: 'A coach report that mentions you.',
}

/**
 * Player-facing report detail — self-scoped through /api/me/reports/:id, so
 * the server only ever returns rows whose student is the caller. Anything
 * else 404s (or comes back `report: null` when the player isn't linked yet).
 */
export default async function PlayerReportPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params

  // Session + report resolve in parallel (the report fetch is self-scoped
  // and takes only the id). Unauthenticated requests pay one wasted fetch
  // before the redirect below.
  const [session, reportRes] = await Promise.all([
    getSession(),
    getMyReport(id).catch(() => ({ report: null, linked: false })),
  ])
  if (!session) redirect('/auth/login')
  const { report } = reportRes
  if (!report) notFound()

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['My hub', report.title || 'Untitled']}
        title={report.title || 'Untitled'}
        description={`${report.full_name || 'Your coach'} · ${
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
