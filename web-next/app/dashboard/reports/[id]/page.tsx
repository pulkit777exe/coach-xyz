import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth0 } from "@/lib/auth0"
import { redirect } from "next/navigation"
import { orgReport } from "@/lib/org"
import { unstable_noStore as noStore } from "next/cache"
import ReportBody, { shortDate } from "@/components/org/ReportBody"
import PrintReportButton from "@/components/org/PrintReportButton"

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: "Report | CoachXYZ", description: "Generated coach report." }
}

const TYPE_LABELS: Record<string, string> = {
  progress: "Progress Report",
  attendance: "Attendance Report",
  performance: "Performance Report",
  monthly: "Monthly Summary",
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const session = await auth0.getSession()
  if (!session) redirect("/auth/login")
  const auth0Id = session.user.sub
  const { id } = await params

  const { report } = await orgReport(auth0Id, id).catch(() => ({ report: null }))
  if (!report) notFound()

  return (
    <div className="p-8 lg:p-12 max-w-3xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">Reports</p>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl leading-none text-(--fg) sm:text-5xl">{report.title}</h1>
          <p className="text-muted-foreground mt-3 text-sm">
            {report.full_name || "Organization"} · {TYPE_LABELS[report.report_type] ?? report.report_type} ·{" "}
            {report.period_start ? `${shortDate(report.period_start)} → ${shortDate(report.period_end ?? report.period_start)}` : "All time"}
          </p>
        </div>
        <PrintReportButton />
      </div>

      <ReportBody report={report} showGenerated />

      <style>{`@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
    </div>
  )
}