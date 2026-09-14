"use client"

import { useEffect, useState } from "react"
import { CalendarIcon, TrendingUpIcon, ClipboardListIcon, ActivityIcon } from "lucide-react"

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

export default function PlayerHub({ auth0Id }: { auth0Id: string }) {
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
      <div className="p-10 flex items-center gap-3 text-(--cream-40)">
        <Spinner /> Loading your hub…
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="p-10">
        <p className="text-sm text-(--red)">{state.message}</p>
      </div>
    )
  }

  const { profile, attendance, schedule, performance, analyses, reports } = state.data
  void auth0Id

  if (!profile.student) {
    return (
      <div className="max-w-2xl mx-auto p-10">
        <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
          My Hub
        </p>
        <h1 className="font-serif text-4xl text-(--fg) leading-none mb-6">
          Welcome{profile.user?.name ? `, ${profile.user.name.split(" ")[0]}` : ""}
        </h1>
        <div className="border border-(--cream-10) p-8">
          <p className="text-sm text-(--fg)">
            Your coach hasn’t linked you to a team yet. Ask your coach to add your
            email (<span className="text-(--fg) font-mono">{profile.user?.email ?? "your email"}</span>){" "}
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
    <div className="p-10">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        My Hub
      </p>
      <h1 className="font-serif text-4xl text-(--fg) leading-none mb-2">
        {student.full_name}
      </h1>
      <div className="flex items-center gap-4 mb-10 text-sm text-(--cream-40)">
        {student.sport && <span>{student.sport}</span>}
        {student.jersey_number !== null && <span>#{student.jersey_number}</span>}
        {student.position && <span>{student.position}</span>}
        {student.status && <span>{STUDENT_STATUS_LABELS[student.status] ?? student.status}</span>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border border-(--cream-10) p-6">
            <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40) mb-4">
              {kpi.label}
            </p>
            <p className="font-serif text-3xl text-(--fg) leading-none mb-2">{kpi.value}</p>
            <p className="text-xs text-(--cream-40)">{kpi.detail}</p>
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
          <ul className="divide-y divide-(--cream-05)">
            {schedule.events.slice(0, 8).map((event) => (
              <li key={event.id} className="py-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-(--fg)">{event.title}</p>
                  <p className="text-xs text-(--cream-40) mt-0.5">
                    {formatDateMed(event.starts_at)} · {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
                <span className="text-xs border border-(--cream-10) px-2 py-1 text-(--cream-40)">
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
          <ul className="divide-y divide-(--cream-05)">
            {attendance.records.slice(0, 8).map((record) => (
              <li key={record.id} className="py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-(--fg)">{formatDateMed(record.session_date)}</p>
                  {record.note && <p className="text-xs text-(--cream-40) mt-0.5">{record.note}</p>}
                </div>
                <span className="text-xs border border-(--cream-10) px-2 py-1">
                  {ATTENDANCE_STATUS_LABELS[record.status]}
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
          <ul className="divide-y divide-(--cream-05)">
            {[...performance.points]
              .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
              .slice(0, 8)
              .map((point, index) => (
                <li key={point.source_analysis_id ?? `${point.measured_at}-${index}`} className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-(--fg)">{formatDateShort(point.measured_at)}</p>
                    <p className="text-xs text-(--cream-40) mt-0.5">
                      {point.metric_key} · {point.source === "analysis" ? "from analysis" : "manual"}
                    </p>
                  </div>
                  <span className="font-serif text-xl text-(--fg)">
                    {point.metric_value}
                    {point.unit ? <span className="text-sm text-(--cream-40)"> {point.unit}</span> : ""}
                  </span>
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
          <ul className="divide-y divide-(--cream-05)">
            {reports.reports.slice(0, 8).map((report) => (
              <li key={report.id} className="py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-(--fg)">{report.title}</p>
                  <p className="text-xs text-(--cream-40) mt-0.5">
                    {REPORT_TYPE_LABELS[report.report_type]} · {formatDateShort(report.created_at)}
                  </p>
                </div>
                <span className="text-xs border border-(--cream-10) px-2 py-1 text-(--cream-40)">
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
    <section className="border border-(--cream-10) p-8 mb-8">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-(--cream-40)">{icon}</span>
        <h2 className="text-[0.65rem] uppercase tracking-[0.25em] text-(--fg)">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-(--cream-40)">{children}</p>
}

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "—"
  return `${from ? formatDateShort(from) : ""}${from && to ? " – " : ""}${to ? formatDateShort(to) : ""}`
}