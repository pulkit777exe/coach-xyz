"use client"

import { useEffect, useState } from "react"
import { CalendarIcon, TrendingUpIcon, ClipboardListIcon, ActivityIcon, SparklesIcon } from "lucide-react"

import { Spinner } from "@/components/org/Spinner"
import type { CoachAIError } from "@/lib/api"
import {
  getMyProfile,
  getMyAttendance,
  getMySchedule,
  getMyPerformance,
  getMyAnalyses,
  getMyReports,
  type MyProfile,
  type MyAttendance,
  type MySchedule,
  type MyPerformance,
  type MyAnalyses,
  type MyReports,
} from "@/lib/meApi"
import {
  ATTENDANCE_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  REPORT_TYPE_LABELS,
  STUDENT_STATUS_LABELS,
} from "@/lib/org"
import { formatDateMed, formatDateShort } from "@/lib/date"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: HubData }

type HubData = {
  profile: MyProfile
  attendance: MyAttendance
  schedule: MySchedule
  performance: MyPerformance
  analyses: MyAnalyses
  reports: MyReports
}

export default function PlayerHub() {
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getMyProfile(),
      getMyAttendance(),
      getMySchedule(),
      getMyPerformance(),
      getMyAnalyses(),
      getMyReports(),
    ])
      .then(([profile, attendance, schedule, performance, analyses, reports]) => {
        if (cancelled) return
        setState({ status: "ready", data: { profile, attendance, schedule, performance, analyses, reports } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const coachErr = error as CoachAIError
        setState({
          status: "error",
          message: coachErr?.message ?? "Failed to load your hub.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-3 p-8 text-muted-foreground">
        <Spinner /> Loading your hub…
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="p-8">
        <p className="text-sm text-destructive">{state.message}</p>
      </div>
    )
  }

  const { profile, attendance, schedule, performance, analyses, reports } = state.data

  if (!profile.student) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">My Hub</p>
        <h1 className="mb-6 text-[28px] font-bold tracking-tight text-foreground">
          Welcome{profile.user?.name ? `, ${profile.user.name.split(" ")[0]}` : ""}
        </h1>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="text-sm leading-6 text-muted-foreground">
            Your coach hasn&apos;t linked you to a team yet. Ask your coach to add your
            email (<span className="font-mono text-foreground">{profile.user?.email ?? "your email"}</span>){" "}
            to your student profile and log in again.
          </p>
        </div>
      </div>
    )
  }

  const student = profile.student
  const attendanceRate = attendance.summary?.attendance_rate
  const upcoming = schedule.events
    .filter((e) => e.status === "scheduled" && new Date(e.starts_at) >= new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]

  const kpis = [
    {
      label: "Attendance Rate",
      value: attendanceRate === null || attendanceRate === undefined ? "—" : `${attendanceRate}%`,
      detail: attendance.summary
        ? `${attendance.summary.present} present · ${attendance.summary.absent} absent`
        : "No sessions yet",
    },
    {
      label: "Next Event",
      value: upcoming ? EVENT_TYPE_LABELS[upcoming.event_type] : "—",
      detail: upcoming ? `${formatDateMed(upcoming.starts_at)} · ${upcoming.title}` : "Nothing scheduled",
    },
    {
      label: "Analyses",
      value: String(analyses.analyses.length),
      detail: analyses.analyses.length
        ? `Latest: ${formatDateShort(analyses.analyses[0].requested_at)}`
        : "No analyses yet",
    },
    {
      label: "Reports",
      value: String(reports.reports.length),
      detail: reports.reports.length
        ? `Latest: ${formatDateShort(reports.reports[0].created_at)}`
        : "No reports yet",
    },
  ]

  return (
    <div className="max-w-5xl p-8 lg:p-12">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        My Hub
      </p>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">
        {student.full_name}
      </h1>
      <div className="mb-8 mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {student.sport && <span>{student.sport}</span>}
        {student.jersey_number !== null && <span>#{student.jersey_number}</span>}
        {student.position && <span>{student.position}</span>}
        {student.status && <span>{STUDENT_STATUS_LABELS[student.status] ?? student.status}</span>}
      </div>

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {kpi.label}
            </p>
            <p className="mb-1 text-2xl font-bold tracking-tight text-foreground">{kpi.value}</p>
            <p className="text-xs text-muted-foreground">{kpi.detail}</p>
          </div>
        ))}
      </div>

      {/* Schedule */}
      <Section
        icon={<CalendarIcon className="size-4" />}
        title="Schedule"
      >
        {schedule.events.length === 0 ? (
          <Empty>No upcoming events.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {schedule.events.slice(0, 8).map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{event.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateMed(event.starts_at)} · {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {EVENT_STATUS_LABELS[event.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Attendance */}
      <Section
        icon={<ClipboardListIcon className="size-4" />}
        title="Attendance"
      >
        {attendance.records.length === 0 ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {attendance.records.slice(0, 8).map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{formatDateMed(record.session_date)}</p>
                  {record.note && <p className="mt-0.5 text-xs text-muted-foreground">{record.note}</p>}
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs">
                  {ATTENDANCE_STATUS_LABELS[record.status] ?? record.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Performance */}
      <Section
        icon={<TrendingUpIcon className="size-4" />}
        title="Performance Trend"
      >
        {performance.points.length === 0 ? (
          <Empty>No performance data yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {[...performance.points]
              .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
              .slice(0, 8)
              .map((point, index) => (
                <li key={point.source_analysis_id ?? `${point.measured_at}-${index}`} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{formatDateShort(point.measured_at)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {point.metric_key} · {point.source === "analysis" ? "from analysis" : "manual"}
                    </p>
                  </div>
                  <span className="text-lg font-bold tracking-tight text-foreground">
                    {point.metric_value}
                    {point.unit ? <span className="text-sm font-normal text-muted-foreground"> {point.unit}</span> : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      {/* Analyses */}
      <Section
        icon={<SparklesIcon className="size-4" />}
        title="Analyses"
      >
        {analyses.analyses.length === 0 ? (
          <Empty>No analyses yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {analyses.analyses.slice(0, 8).map((analysis) => (
              <li key={analysis.server_job_id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {analysis.display_name || "Untitled video"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateShort(analysis.requested_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {analysisScore(analysis) !== null && (
                    <span className="text-lg font-bold tracking-tight text-foreground">{analysisScore(analysis)}</span>
                  )}
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${
                      analysis.complete
                        ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {analysis.complete ? "Done" : "Processing"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Reports */}
      <Section
        icon={<ActivityIcon className="size-4" />}
        title="Reports"
      >
        {reports.reports.length === 0 ? (
          <Empty>No reports yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {reports.reports.slice(0, 8).map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{report.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {REPORT_TYPE_LABELS[report.report_type] ?? report.report_type} · {formatDateShort(report.created_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {periodLabel(report.period_start, report.period_end)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "—"
  return `${from ? formatDateShort(from) : ""}${from && to ? " – " : ""}${to ? formatDateShort(to) : ""}`
}

function analysisScore(analysis: MyAnalyses["analyses"][number]): number | null {
  if (!analysis.summary_json || typeof analysis.summary_json !== "object" || !("form_score" in analysis.summary_json)) {
    return null
  }
  const score = (analysis.summary_json as { form_score: unknown }).form_score
  return typeof score === "number" ? score : null
}