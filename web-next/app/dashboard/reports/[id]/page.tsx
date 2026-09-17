import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { getOrgContext, orgReport } from "@/lib/serverData";
import { REPORT_TYPE_LABELS } from "@/lib/org"
import type { ReportType } from "@/lib/org"
import { formatDateMed } from "@/lib/date"
import { unstable_noStore as noStore } from "next/cache"
import ReportBody from "@/components/org/ReportBody"
import PrintReportButton from "@/components/org/PrintReportButton"

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: "Report | CoachXYZ", description: "Generated coach report." }
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const { auth0Id } = await getOrgContext()
  const { id } = await params

  const { report } = await orgReport(auth0Id, id).catch(() => ({ report: null }))
  if (!report) notFound()

  return (
    <div className="mx-auto max-w-[800px] px-6 py-6 lg:px-8">
      <p className="mb-1 text-sm text-muted-foreground">Reports / Detail</p>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">{report.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.full_name || "Organization"} · {REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type} ·{" "}
            {report.period_start ? `${formatDateMed(report.period_start)} → ${formatDateMed(report.period_end ?? report.period_start)}` : "All time"}
          </p>
        </div>
        <PrintReportButton />
      </div>

      <ReportBody report={report} showGenerated />

      <style>{`@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
    </div>
  )
}