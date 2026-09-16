import type { ReportContent, ReportRecord } from "@/lib/org"
import { ATTENDANCE_STATUS_LABELS, STUDENT_STATUS_LABELS } from "@/lib/org"
import { formatDateMed } from "@/lib/date"

const TYPE_ORDER: Record<string, string[]> = {
  attendance: ["summary", "org", "attendance", "performance", "analyses"],
  performance: ["summary", "org", "performance", "attendance", "analyses"],
  progress: ["summary", "org", "attendance", "performance", "analyses"],
  monthly: ["summary", "org", "attendance", "performance", "analyses"],
}

export default function ReportBody({
  report,
  showGenerated = false,
}: {
  report: ReportRecord
  showGenerated?: boolean
}) {
  const c = report.content_json as ReportContent | null
  const has = (k: string) => {
    if (!c) return false
    if (k === "org") return Boolean(c.org)
    if (k === "summary") return typeof c.summary === "string" && c.summary.length > 0
    if (k === "attendance") return Boolean(c.attendance)
    if (k === "performance") return Boolean(c.performance)
    if (k === "analyses") return (c.analyses ?? []).length > 0
    return false
  }

  const order = TYPE_ORDER[report.report_type] ?? TYPE_ORDER.progress

  if (!c) {
    return <p className="text-muted-foreground text-sm">This report has no content.</p>
  }

  return (
    <div className="space-y-5 text-sm">
      {showGenerated &&
        (() => {
          const gen = c.generated_at
          if (!gen) return null
          return (
            <p className="text-muted-foreground text-xs">
              Generated {new Date(gen).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )
        })()}

      {c.period?.label && c.period.label !== "All time" && (
        <p className="text-muted-foreground text-xs">{c.period.label}</p>
      )}

      {order.map((k) => {
        if (!has(k)) return null
        if (k === "org") return <OrgStatStrip key={k} c={c} />
        if (k === "summary") return <SummaryBlock key={k} c={c} />
        if (k === "attendance") return <AttendanceBlock key={k} c={c} />
        if (k === "performance") return <PerformanceBlock key={k} c={c} />
        if (k === "analyses") return <AnalysesBlock key={k} c={c} />
        return null
      })}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-[0.6rem] uppercase tracking-[0.2em]">{title}</p>
      {children}
    </div>
  )
}

function StatCells({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-card p-3">
          <p className="text-lg font-semibold text-foreground">{value}</p>
          <p className="text-muted-foreground text-[0.6rem] uppercase tracking-[0.15em]">{label}</p>
        </div>
      ))}
    </div>
  )
}

function SummaryBlock({ c }: { c: ReportContent }) {
  return (
    <div className="border-border bg-muted/30 rounded-md border p-4">
      <p className="text-muted-foreground mb-1 text-[0.6rem] uppercase tracking-[0.2em]">Summary</p>
      <p className="text-foreground">{c.summary}</p>
    </div>
  )
}

function OrgStatStrip({ c }: { c: ReportContent }) {
  const o = c.org
  if (!o) return null
  return (
    <Section title="Organization">
      <StatCells
        items={[
          ["Students", String(o.student_count)],
          [STUDENT_STATUS_LABELS.active, String(o.active_students)],
          ["Sessions this month", String(o.sessions_this_month)],
          ["Upcoming events", String(o.upcoming_events)],
          ["Analyses linked", String(o.analyses_linked)],
          ["Att rate (30d)", o.avg_attendance_rate === null ? "—" : `${o.avg_attendance_rate}%`],
        ].slice(0, 6) as [string, string][]}
      />
    </Section>
  )
}

function AttendanceBlock({ c }: { c: ReportContent }) {
  const a = c.attendance
  return (
    <Section title="Attendance">
      <StatCells
        items={[
          ["Records", String(a.total_records)],
          [ATTENDANCE_STATUS_LABELS.present, String(a.present)],
          [ATTENDANCE_STATUS_LABELS.late, String(a.late)],
          [ATTENDANCE_STATUS_LABELS.absent, String(a.absent)],
          [ATTENDANCE_STATUS_LABELS.excused, String(a.excused)],
          ["Rate", a.attendance_rate === null ? "—" : `${a.attendance_rate}%`],
        ]}
      />
    </Section>
  )
}

function PerformanceBlock({ c }: { c: ReportContent }) {
  const p = c.performance
  return (
    <Section title="Performance">
      <StatCells
        items={[
          ["Avg form", p.form_score_avg === null ? "—" : `${p.form_score_avg}/10`],
          ["Latest form", p.form_score_latest === null ? "—" : `${p.form_score_latest}/10`],
          ["Analyzed sessions", String(p.total_sessions)],
          ["Last analysis", p.latest_analysis_at ? formatDateMed(p.latest_analysis_at.slice(0, 10)) : "—"],
        ]}
      />
    </Section>
  )
}

function AnalysesBlock({ c }: { c: ReportContent }) {
  const analyses = c.analyses ?? []
  return (
    <Section title="Referenced analyses">
      <ul className="space-y-1">
        {analyses.map((a) => (
          <li
            key={a.server_job_id}
            className="flex justify-between border-b border-border/60 py-1.5 text-sm"
          >
            <span className="text-foreground">{a.display_name || "Untitled video"}</span>
            <span className="text-muted-foreground">
              {a.form_score === null ? "—" : `${a.form_score}/10`}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}