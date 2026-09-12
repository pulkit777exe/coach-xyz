"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  PlusIcon,
  PencilIcon,
  LinkIcon,
  UnlinkIcon,
  MailIcon,
  PhoneIcon,
  CalendarIcon,
} from "lucide-react"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"

import { Button } from "@/components/9ui/ui/button"
import { Badge } from "@/components/9ui/ui/badge"
import { Input } from "@/components/9ui/ui/input"
import { Label } from "@/components/9ui/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/9ui/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/9ui/ui/dropdown-menu"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/9ui/ui/chart"
import { Spinner } from "./Spinner"
import StudentFormDialog from "./StudentFormDialog"

import type { Student, PerformanceSeriesPoint, AttendanceSummary } from "@/lib/org"
import type { DashboardAnalysis, CoachAIError } from "@/lib/api"
import {
  orgStudentPerformance,
  orgAddPerformanceMetric,
  linkAnalysisToStudent,
  orgAttendanceSummary,
} from "@/lib/org"

const STATUS_STYLE: Record<string, string> = {
  active: "border-(--success-border) text-(--success) bg-(--success)",
  inactive: "border-(--warning-border) text-(--warning)",
  transferred: "border-border text-muted-foreground",
}

const METRIC_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
]

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

export default function StudentProfile({
  auth0Id,
  student,
  initialSeries,
  initialAttendance,
  allAnalyses,
  sports,
}: {
  auth0Id: string
  student: Student
  initialSeries: PerformanceSeriesPoint[]
  initialAttendance: AttendanceSummary | null
  allAnalyses: DashboardAnalysis[]
  sports: string[]
}) {
  const [student_, setStudent] = useState<Student>(student)
  const [series, setSeries] = useState<PerformanceSeriesPoint[]>(initialSeries)
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(initialAttendance)
  const [editOpen, setEditOpen] = useState(false)

  const [selectedKey, setSelectedKey] = useState<string>("all")
  const [isMetricSubmitting, setMetricSubmitting] = useState(false)
  const [metricForm, setMetricForm] = useState({ metric_key: "", metric_value: "", unit: "", measured_at: "" })

  const keys = useMemo(() => [...new Set(series.map((s) => s.metric_key))].sort(), [series])

  const chartData = useMemo(() => {
    if (selectedKey === "all") return series
    return series.filter((s) => s.metric_key === selectedKey)
  }, [series, selectedKey])

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {}
    for (const s of series) {
      if (!config[s.metric_key]) {
        config[s.metric_key] = {
          label: formatKey(s.metric_key),
          color: METRIC_COLORS[Object.keys(config).length % METRIC_COLORS.length],
        }
      }
    }
    return config
  }, [series])

  const linked = allAnalyses.filter((a) => a.student_id === student_.id)
  const unlinked = allAnalyses.filter((a) => !a.student_id)

  const addMouseMetric = async () => {
    const raw = Number(metricForm.metric_value)
    if (!Number.isFinite(raw)) {
      toast.error("Enter a numeric metric value")
      return
    }
    const payload: {
      metric_key: string
      metric_value: number
      unit?: string
      measured_at?: string
    } = {
      metric_key: metricForm.metric_key.trim() || "form_score",
      metric_value: raw,
    }
    if (metricForm.unit.trim()) payload.unit = metricForm.unit.trim()
    if (metricForm.measured_at) payload.measured_at = metricForm.measured_at

    setMetricSubmitting(true)
    try {
      const res = await orgAddPerformanceMetric(auth0Id, student_.id, payload)
      setSeries((prev) => [
        ...prev,
        {
          measured_at: res.metric.measured_at,
          metric_key: res.metric.metric_key,
          metric_value: res.metric.metric_value,
          unit: res.metric.unit,
          source: "manual",
          source_analysis_id: null,
        },
      ])
      setMetricForm({ metric_key: "", metric_value: "", unit: "", measured_at: "" })
      toast.success("Metric logged")
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to log metric")
    } finally {
      setMetricSubmitting(false)
    }
  }

  const setAnalysisLink = async (analysis: DashboardAnalysis, studentId: string | null) => {
    try {
      const res = await linkAnalysisToStudent(auth0Id, analysis.server_job_id, studentId)
      toast.success(studentId ? "Analysis linked" : "Analysis unlinked")
      const updated: DashboardAnalysis = {
        ...analysis,
        student_id: res.analysis.student_id ?? null,
      }
      allAnalyses.splice(allAnalyses.indexOf(analysis), 1, updated)
      refreshAttendance()
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to update link")
    }
  }

  const refresh = async () => {
    const [seriesRes, attRes] = await Promise.all([
      orgStudentPerformance(auth0Id, student_.id),
      orgAttendanceSummary(auth0Id, { studentId: student_.id }),
    ])
    setSeries(seriesRes.series)
    setAttendance(attRes.summary)
  }

  const refreshAttendance = async () => {
    const attRes = await orgAttendanceSummary(auth0Id, { studentId: student_.id }).catch(() => null)
    if (attRes) setAttendance(attRes.summary)
  }

  const attStats = [
    { label: "Present", value: attendance?.present ?? 0, color: "var(--color-success)" },
    { label: "Late", value: attendance?.late ?? 0, color: "var(--color-warning)" },
    { label: "Absent", value: attendance?.absent ?? 0, color: "var(--color-destructive)" },
    { label: "Excused", value: attendance?.excused ?? 0, color: "var(--color-info)" },
  ]

  return (
    <div>
      {/* Header */}
      <div className="border-border bg-card flex flex-col gap-5 rounded-lg border p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="border-border size-16 border">
            <AvatarImage src={undefined} alt="" />
            <AvatarFallback className="bg-secondary text-secondary-foreground font-serif text-xl">
              {initials(student_.full_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-serif text-2xl text-(--fg)">{student_.full_name}</h2>
              <Badge
                className={
                  (STATUS_STYLE[student_.status] ?? "border-border text-muted-foreground") + " border"
                }
              >
                {student_.status}
              </Badge>
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {student_.sport && <span>{student_.sport}</span>}
              {student_.position && <span>{student_.position}</span>}
              {student_.jersey_number && <span>#{student_.jersey_number}</span>}
              {student_.gender && <span className="capitalize">{student_.gender}</span>}
            </div>
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {student_.email && (
                <span className="flex items-center gap-1.5">
                  <MailIcon className="size-3" /> {student_.email}
                </span>
              )}
              {student_.phone && (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3" /> {student_.phone}
                </span>
              )}
              {student_.joined_on && (
                <span className="flex items-center gap-1.5">
                  <CalendarIcon className="size-3" /> Joined{" "}
                  {formatDate(student_.joined_on)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <PencilIcon />
            Edit
          </Button>
        </div>
      </div>

      {/* Attendance summary */}
      <div className="mt-8">
        <p className="mb-3 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
          Attendance Overview
        </p>
        <div className="grid grid-cols-2 gap-px bg-(--cream-05) md:grid-cols-4">
          {attStats.map((s) => (
            <div key={s.label} className="bg-(--bg) p-5">
              <p className="font-serif text-2xl" style={{ color: s.color }}>
                {s.value}
              </p>
              <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
                {s.label}
              </p>
            </div>
          ))}
          <div className="bg-(--bg) p-5">
            <p className="font-serif text-2xl text-(--fg)">
              {attendance?.attendance_rate === null ? "—" : `${attendance?.attendance_rate ?? 0}%`}
            </p>
            <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
              Attendance Rate
            </p>
          </div>
        </div>
      </div>

      {/* Performance chart */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Performance Trend
          </p>
          {keys.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <MetricPill active={selectedKey === "all"} onClick={() => setSelectedKey("all")}>
                All
              </MetricPill>
              {keys.map((k) => (
                <MetricPill
                  key={k}
                  active={selectedKey === k}
                  onClick={() => setSelectedKey(k)}
                >
                  {formatKey(k)}
                </MetricPill>
              ))}
            </div>
          )}
        </div>

        <div className="border-border bg-card rounded-lg border p-4">
          {chartData.length ? (
            <ChartContainer config={chartConfig} className="aspect-[16/7]">
              <LineChart data={chartData} margin={{ left: -14, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="measured_at"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(v: string) => formatDateShort(v)}
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} domain={["auto", "auto"]} />
                <ChartTooltip
                  content={<ChartTooltipContent style={{ background: "var(--color-popover)" }} />}
                  cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                />
                {Object.entries(chartConfig).map(([key, cfg]) => (
                  <Line
                    key={key}
                    dataKey="metric_value"
                    name={key}
                    type="monotone"
                    stroke={cfg.color}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: cfg.color }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="flex h-40 items-center justify-center">
              <p className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                No performance metrics yet — log one below
              </p>
            </div>
          )}
        </div>

        {/* Log metric */}
        <div className="border-border bg-card mt-4 flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="metric_key" className="text-xs">
              Metric
            </Label>
            <Input
              id="metric_key"
              className="h-8 w-40 text-sm"
              placeholder="form_score"
              value={metricForm.metric_key}
              onChange={(e) => setMetricForm((f) => ({ ...f, metric_key: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="metric_value" className="text-xs">
              Value *
            </Label>
            <Input
              id="metric_value"
              type="number"
              step="any"
              className="h-8 w-24 text-sm"
              value={metricForm.metric_value}
              onChange={(e) => setMetricForm((f) => ({ ...f, metric_value: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="metric_unit" className="text-xs">
              Unit
            </Label>
            <Input
              id="metric_unit"
              className="h-8 w-24 text-sm"
              placeholder="pts"
              value={metricForm.unit}
              onChange={(e) => setMetricForm((f) => ({ ...f, unit: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="metric_at" className="text-xs">
              Date
            </Label>
            <Input
              id="metric_at"
              type="date"
              className="h-8 w-36 text-sm"
              value={metricForm.measured_at}
              onChange={(e) => setMetricForm((f) => ({ ...f, measured_at: e.target.value }))}
            />
          </div>
          <Button size="sm" onClick={addMouseMetric} disabled={isMetricSubmitting}>
            {isMetricSubmitting ? <Spinner /> : <PlusIcon />} Log metric
          </Button>
        </div>
      </div>

      {/* Linked analyses */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Linked Analyses
          </p>
          {unlinked.length > 0 && (
            <LinkAnalysisSelect
              unlinked={unlinked}
              onPick={(a) => setAnalysisLink(a, student_.id)}
            />
          )}
        </div>

        {linked.length === 0 ? (
          <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No analyses linked to {student_.full_name}.
            </p>
            <p className="text-xs text-(--cream-40)">
              {unlinked.length
                ? "Choose an analysis above to build this player's profile."
                : "Run a video analysis first, then link it here."}
            </p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase">
                  <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                    Analysis
                  </th>
                  <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                    Date
                  </th>
                  <th className="hidden px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em] md:table-cell">
                    Form
                  </th>
                  <th className="px-4 py-3 text-right font-normal text-[0.65rem] tracking-[0.15em]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {linked.map((a) => (
                  <tr key={a.server_job_id} className="hover:bg-accent/50 border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/analysis/${a.server_job_id}`} className="hover:underline">
                        {a.display_name || a.file_name || "Untitled video"}
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {new Date(a.requested_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json
                        ? (a.summary_json as { form_score: number }).form_score
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => setAnalysisLink(a, null)}
                      >
                        <UnlinkIcon className="size-3.5" /> Unlink
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StudentFormDialog
        key={student_.id}
        auth0Id={auth0Id}
        open={editOpen}
        onOpenChange={setEditOpen}
        student={student_}
        sports={sports}
        onUpdated={(s) => {
          setStudent(s)
          refresh()
        }}
        onCreated={() => undefined}
      />
    </div>
  )
}

function MetricPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.15em] transition-colors ${
        active
          ? "text-(--fg) border-(--cream-20) bg-(--cream-05)"
          : "text-(--cream-40) border-(--cream-10) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  )
}

function LinkAnalysisSelect({
  unlinked,
  onPick,
}: {
  unlinked: DashboardAnalysis[]
  onPick: (a: DashboardAnalysis) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <LinkIcon className="size-3.5" /> Link analysis
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {unlinked.map((a) => (
          <DropdownMenuItem key={a.server_job_id} onClick={() => onPick(a)}>
            <span className="max-w-56 truncate">{a.display_name || a.file_name || "Untitled video"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatKey(key: string) {
  return key
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateShort(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}