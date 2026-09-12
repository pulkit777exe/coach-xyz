"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  LinkIcon,
  UnlinkIcon,
  MailIcon,
  PhoneIcon,
  CalendarIcon,
  FileTextIcon,
} from "lucide-react"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"

import { Button } from "@/components/9ui/ui/button"
import { Badge } from "@/components/9ui/ui/badge"
import { Input } from "@/components/9ui/ui/input"
import { Label } from "@/components/9ui/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/9ui/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/9ui/ui/dialog"
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

import type { Student, PerformanceSeriesPoint, AttendanceSummary, ReportRecord } from "@/lib/org"
import type { DashboardAnalysis, CoachAIError } from "@/lib/api"
import {
  orgStudentPerformance,
  orgAddPerformanceMetric,
  orgDeletePerformanceMetric,
  orgUpdatePerformanceMetric,
  orgDeleteStudent,
  orgDeleteReport,
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
  initialReports,
  allAnalyses,
  sports,
}: {
  auth0Id: string
  student: Student
  initialSeries: PerformanceSeriesPoint[]
  initialAttendance: AttendanceSummary | null
  initialReports: ReportRecord[]
  allAnalyses: DashboardAnalysis[]
  sports: string[]
}) {
  const router = useRouter()
  const [student_, setStudent] = useState<Student>(student)
  const [series, setSeries] = useState<PerformanceSeriesPoint[]>(initialSeries)
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(initialAttendance)
  const [reports, setReports] = useState<ReportRecord[]>(initialReports)
  const [editOpen, setEditOpen] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    action: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const [selectedKey, setSelectedKey] = useState<string>("all")
  const [isMetricSubmitting, setMetricSubmitting] = useState(false)
  const [editingMetric, setEditingMetric] = useState<PerformanceSeriesPoint | null>(null)
  const [metricForm, setMetricForm] = useState({ metric_key: "", metric_value: "", unit: "", measured_at: "" })

  const keys = useMemo(() => [...new Set(series.map((s) => s.metric_key))].sort(), [series])

  const chartData = useMemo(() => {
    const includeAll = selectedKey === "all"
    const rows: Record<string, string | number>[] = []
    const byDate = new Map<string, Record<string, string | number>>()
    for (const s of series) {
      if (!includeAll && s.metric_key !== selectedKey) continue
      const date = s.measured_at.slice(0, 10)
      let row = byDate.get(date)
      if (!row) {
        row = { date }
        byDate.set(date, row)
        rows.push(row)
      }
      row[s.metric_key] = s.metric_value
    }
    return rows
  }, [series, selectedKey])

  const shownKeys = useMemo(
    () => (selectedKey === "all" ? keys : [selectedKey]),
    [selectedKey, keys],
  )

  const manualPoints = useMemo(
    () =>
      series
        .filter((s) => s.source === "manual")
        .slice()
        .sort((a, b) => b.measured_at.localeCompare(a.measured_at)),
    [series],
  )

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

  const runConfirm = async () => {
    if (!confirm) return
    setConfirmBusy(true)
    try {
      await confirm.action()
      setConfirm(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const addMouseMetric = async () => {
    const raw = Number(metricForm.metric_value)
    if (!Number.isFinite(raw)) {
      toast.error("Enter a numeric metric value")
      return
    }
    const payload: {
      metric_key: string
      metric_value: number
      unit?: string | null
      measured_at?: string
    } = {
      metric_key: metricForm.metric_key.trim() || "form_score",
      metric_value: raw,
    }
    if (metricForm.unit.trim()) payload.unit = metricForm.unit.trim()
    else payload.unit = null
    if (metricForm.measured_at) payload.measured_at = metricForm.measured_at

    setMetricSubmitting(true)
    try {
      if (editingMetric) {
        const id = editingMetric.id
        if (!id) return
        await orgUpdatePerformanceMetric(auth0Id, id, {
          metric_value: payload.metric_value,
          unit: payload.unit ?? null,
        })
      } else {
        await orgAddPerformanceMetric(auth0Id, student_.id, payload)
      }
      toast.success(editingMetric ? "Metric updated" : "Metric logged")
      setEditingMetric(null)
      setMetricForm({ metric_key: "", metric_value: "", unit: "", measured_at: "" })
      await refresh()
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to log metric")
    } finally {
      setMetricSubmitting(false)
    }
  }

  const openMetricEdit = (p: PerformanceSeriesPoint) => {
    setEditingMetric(p)
    setMetricForm({
      metric_key: p.metric_key,
      metric_value: String(p.metric_value),
      unit: p.unit ?? "",
      measured_at: p.measured_at.slice(0, 10),
    })
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
      await refresh()
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
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground hover:text-(--danger)"
            onClick={() =>
              setConfirm({
                title: `Remove ${student_.full_name}?`,
                description:
                  "This will permanently delete the student and their attendance records. Past reports keep a snapshot. This cannot be undone.",
                action: async () => {
                  await orgDeleteStudent(auth0Id, student_.id)
                  toast.success(`${student_.full_name} removed`)
                  router.push("/dashboard/students")
                },
              })
            }
          >
            <TrashIcon />
            Delete
          </Button>
        </div>
      </div>

      {/* Profile details */}
      <div className="mt-8">
        <p className="mb-3 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
          Profile Details
        </p>
        <div className="border-border bg-card grid gap-px rounded-lg border sm:grid-cols-2">
          <DetailRow label="Date of birth" value={student_.date_of_birth ? formatDate(student_.date_of_birth) : "—"} />
          <DetailRow label="Gender" value={student_.gender ? capitalize(student_.gender) : "—"} />
          <DetailRow label="Guardian" value={student_.guardian_name || "—"} />
          <DetailRow label="Guardian phone" value={student_.guardian_phone || "—"} />
          <div className="border-border border-t p-4 sm:col-span-2">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">Notes</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap text-sm">
              {student_.notes || "No notes recorded."}
            </p>
          </div>
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
                  dataKey="date"
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
                {shownKeys.map((key) => (
                  <Line
                    key={key}
                    dataKey={key}
                    name={key}
                    type="monotone"
                    stroke={chartConfig[key]?.color}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: chartConfig[key]?.color }}
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
        <div className="border-border bg-card mt-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="metric_key" className="text-xs">
                Metric
              </Label>
              <Input
                id="metric_key"
                className="h-8 w-40 text-sm"
                placeholder="form_score"
                disabled={Boolean(editingMetric)}
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
                disabled={Boolean(editingMetric)}
                value={metricForm.measured_at}
                onChange={(e) => setMetricForm((f) => ({ ...f, measured_at: e.target.value }))}
              />
            </div>
            <Button size="sm" onClick={addMouseMetric} disabled={isMetricSubmitting}>
              {isMetricSubmitting ? <Spinner /> : editingMetric ? <PencilIcon /> : <PlusIcon />}{" "}
              {editingMetric ? "Update metric" : "Log metric"}
            </Button>
            {editingMetric && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingMetric(null)
                  setMetricForm({ metric_key: "", metric_value: "", unit: "", measured_at: "" })
                }}
              >
                Cancel
              </Button>
            )}
          </div>

          {manualPoints.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border pt-3">
              {manualPoints.map((p) => (
                <li
                  key={p.id ?? `${p.metric_key}-${p.measured_at}`}
                  className="flex items-center justify-between gap-2 py-1 text-sm"
                >
                  <span className="text-(--fg)">
                    {formatKey(p.metric_key)}{" "}
                    <span className="text-muted-foreground">
                      {p.metric_value}
                      {p.unit ? ` ${p.unit}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs">{formatDateShort(p.measured_at)}</span>
                    {p.id && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        onClick={() => openMetricEdit(p)}
                        aria-label="Edit metric"
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-(--danger)"
                      onClick={() =>
                        p.id &&
                        setConfirm({
                          title: "Delete this metric?",
                          description: `${formatKey(p.metric_key)} · ${p.metric_value}${p.unit ? ` ${p.unit}` : ""} on ${formatDateShort(p.measured_at)}.`,
                          action: async () => {
                            await orgDeletePerformanceMetric(auth0Id, p.id as string)
                            toast.success("Metric deleted")
                            await refresh()
                          },
                        })
                      }
                      aria-label="Delete metric"
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
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

      {/* Reports */}
      <div className="mt-8">
        <p className="mb-3 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">Reports</p>
        {reports.length === 0 ? (
          <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border p-10 text-center">
            <FileTextIcon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground text-sm">No reports generated for {student_.full_name} yet.</p>
            <Link href="/dashboard/reports" className="text-(--fg) text-xs underline">
              Go to Reports
            </Link>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <ul>
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="hover:bg-accent/50 border-b border-border last:border-0 flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <Link href={`/dashboard/reports/${r.id}`} className="text-(--fg) hover:underline">
                    {r.title}
                  </Link>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">
                      {new Date(r.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-(--danger)"
                      onClick={() =>
                        setConfirm({
                          title: "Delete this report?",
                          description: "This permanently removes the generated report. This cannot be undone.",
                          action: async () => {
                            await orgDeleteReport(auth0Id, r.id)
                            setReports((prev) => prev.filter((x) => x.id !== r.id))
                            toast.success("Report deleted")
                          },
                        })
                      }
                      aria-label="Delete report"
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
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

      {/* Destructive confirm */}
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runConfirm} disabled={confirmBusy}>
              {confirmBusy ? <Spinner /> : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border border-t p-4 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">{label}</p>
      <p className="text-(--fg) mt-1 text-sm">{value}</p>
    </div>
  )
}

function capitalize(v: string) {
  return v.charAt(0).toUpperCase() + v.slice(1)
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