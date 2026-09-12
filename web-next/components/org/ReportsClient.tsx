"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PlusIcon, EyeIcon, TrashIcon, FileTextIcon } from "lucide-react"

import { Button } from "@/components/9ui/ui/button"
import { Badge } from "@/components/9ui/ui/badge"
import { Input } from "@/components/9ui/ui/input"
import { Label } from "@/components/9ui/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/9ui/ui/dialog"
import { Spinner } from "./Spinner"

import type { ReportRecord, Student } from "@/lib/org"
import { orgReports, orgCreateReport, orgDeleteReport } from "@/lib/org"
import type { CoachAIError } from "@/lib/api"

const REPORT_TYPES = [
  { value: "progress", label: "Progress Report" },
  { value: "attendance", label: "Attendance Report" },
  { value: "performance", label: "Performance Report" },
  { value: "monthly", label: "Monthly Summary" },
] as const

const TYPE_BADGE: Record<string, string> = {
  progress: "border-(--info-border) text-(--info)",
  attendance: "border-(--warning-border) text-(--warning)",
  performance: "border-(--success-border) text-(--success)",
  monthly: "border-(--danger-border) text-(--danger)",
}

function typeLabel(t: string) {
  return REPORT_TYPES.find((r) => r.value === t)?.label ?? t
}

export default function ReportsClient({
  auth0Id,
  initialReports,
  students,
}: {
  auth0Id: string
  initialReports: ReportRecord[]
  students: Student[]
}) {
  const [reports, setReports] = useState<ReportRecord[]>(initialReports)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [viewing, setViewing] = useState<ReportRecord | null>(null)
  const [deleting, setDeleting] = useState<ReportRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    student_id: "all",
    report_type: "progress",
    period_start: "",
    period_end: "",
    title: "",
  })
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await orgCreateReport(auth0Id, {
        student_id: form.student_id !== "all" ? form.student_id : undefined,
        report_type: form.report_type,
        period_start: form.period_start || undefined,
        period_end: form.period_end || undefined,
        title: form.title || undefined,
      })
      setReports((prev) => [res.report, ...prev])
      toast.success("Report generated")
      setGenerateOpen(false)
      setForm({ student_id: "all", report_type: "progress", period_start: "", period_end: "", title: "" })
    } catch (err) {
      setError((err as CoachAIError).message ?? "Failed to generate report")
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await orgDeleteReport(auth0Id, deleting.id)
      setReports((prev) => prev.filter((r) => r.id !== deleting.id))
      toast.success("Report deleted")
      setDeleting(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to delete report")
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-6 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {reports.length} generated {reports.length === 1 ? "report" : "reports"}
        </p>
        <Button size="sm" onClick={() => setGenerateOpen(true)}>
          <PlusIcon /> Generate report
        </Button>
      </div>

      {/* List */}
      {reports.length === 0 ? (
        <div className="border-border bg-card rounded-lg border p-16 text-center">
          <FileTextIcon className="text-muted-foreground mx-auto mb-4 size-8" />
          <p className="text-muted-foreground text-sm">No reports yet.</p>
          <p className="text-(--cream-40) mt-1 text-xs">
            Generate progress, attendance, or performance reports for your students.
          </p>
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase">
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Report
                </th>
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Type
                </th>
                <th className="hidden px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em] md:table-cell">
                  Student
                </th>
                <th className="hidden px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em] lg:table-cell">
                  Period
                </th>
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Generated
                </th>
                <th className="px-4 py-3 text-right font-normal text-[0.65rem] tracking-[0.15em]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-accent/50 border-border border-b last:border-0">
                  <td className="px-4 py-3 font-medium text-(--fg)">
                    <button type="button" onClick={() => setViewing(r)} className="hover:underline">
                      {r.title}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={(TYPE_BADGE[r.report_type] ?? "border-border") + " border"}>
                      {typeLabel(r.report_type)}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{r.full_name || "Organization"}</td>
                  <td className="text-muted-foreground hidden px-4 py-3 lg:table-cell">
                    {r.period_start ? `${shortDate(r.period_start)} → ${shortDate(r.period_end ?? r.period_start)}` : "All time"}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setViewing(r)} aria-label="View report">
                        <EyeIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-(--danger)"
                        onClick={() => setDeleting(r)}
                        aria-label="Delete report"
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Report</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="report_student">Student</Label>
              <select
                id="report_student"
                value={form.student_id}
                onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
                className="bg-input text-foreground focus-visible:ring-ring/50 border-input focus-visible:border-ring h-9 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
              >
                <option value="all">Entire organization</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                    {s.sport ? ` — ${s.sport}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                {form.student_id === "all" ? "Covers the whole organization." : "Scoped to a single student."}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report_type">Report type</Label>
              <select
                id="report_type"
                value={form.report_type}
                onChange={(e) => setForm((f) => ({ ...f, report_type: e.target.value }))}
                className="bg-input text-foreground focus-visible:ring-ring/50 border-input focus-visible:border-ring h-9 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="period_start">Period start</Label>
                <Input
                  id="period_start"
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="period_end">Period end</Label>
                <Input
                  id="period_end"
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report_title">Custom title (optional)</Label>
              <Input
                id="report_title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Q3 Mid-season Review"
              />
            </div>
            {error && <p className="text-sm text-(--danger)">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={submitting}>
              {submitting ? <Spinner /> : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.title}</DialogTitle>
                <DialogDescription>
                  {viewing.full_name || "Organization"} · {typeLabel(viewing.report_type)} ·{" "}
                  {new Date(viewing.created_at).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </DialogDescription>
              </DialogHeader>
              <ReportBody report={viewing} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this report?</DialogTitle>
            <DialogDescription>This permanently removes the generated report. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReportBody({ report }: { report: ReportRecord }) {
  const c = report.content_json ?? {}
  const summary = typeof c.summary === "string" ? c.summary : null
  const period = c.period as { start?: string | null; end?: string | null } | undefined
  const attendance = c.attendance as
    | {
        total_records?: number
        present?: number
        absent?: number
        late?: number
        excused?: number
        attendance_rate?: number | null
      }
    | undefined
  const performance = c.performance as
    | {
        form_score_avg?: number | null
        form_score_latest?: number | null
        total_sessions?: number
        latest_analysis_at?: string | null
      }
    | undefined
  const analyses = (c.analyses as
    | { display_name?: string | null; requested_at?: string; form_score?: number | null }[]
    | undefined) ?? []

  return (
    <div className="space-y-5 text-sm">
      {summary && (
        <div className="border-border bg-muted/30 rounded-md border p-4">
          <p className="text-muted-foreground mb-1 text-[0.6rem] uppercase tracking-[0.2em]">Summary</p>
          <p className="text-(--fg)">{summary}</p>
        </div>
      )}

      <div>
        <p className="text-muted-foreground mb-2 text-[0.6rem] uppercase tracking-[0.2em]">Period</p>
        <p className="text-muted-foreground">
          {period?.start && period?.end ? `${shortDate(period.start)} → ${shortDate(period.end)}` : "All time"}
        </p>
      </div>

      {attendance && (
        <div>
          <p className="text-muted-foreground mb-2 text-[0.6rem] uppercase tracking-[0.2em]">Attendance</p>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
            {[
              ["Records", String(attendance.total_records ?? 0)],
              ["Present", String(attendance.present ?? 0)],
              ["Late", String(attendance.late ?? 0)],
              ["Absent", String(attendance.absent ?? 0)],
              ["Rate", attendance.attendance_rate === null ? "—" : `${attendance.attendance_rate ?? 0}%`],
            ].map(([label, value]) => (
              <div key={label} className="bg-card p-3">
                <p className="font-serif text-lg text-(--fg)">{value}</p>
                <p className="text-muted-foreground text-[0.6rem] uppercase tracking-[0.15em]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {performance && (
        <div>
          <p className="text-muted-foreground mb-2 text-[0.6rem] uppercase tracking-[0.2em]">Performance</p>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {[
              ["Avg form", performance.form_score_avg === null ? "—" : `${performance.form_score_avg}/10`],
              ["Latest form", performance.form_score_latest === null ? "—" : `${performance.form_score_latest}/10`],
              ["Analyzed sessions", String(performance.total_sessions ?? 0)],
              [
                "Last analysis",
                performance.latest_analysis_at ? shortDate(performance.latest_analysis_at.slice(0, 10)) : "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-card p-3">
                <p className="font-serif text-lg text-(--fg)">{value}</p>
                <p className="text-muted-foreground text-[0.6rem] uppercase tracking-[0.15em]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {analyses.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-2 text-[0.6rem] uppercase tracking-[0.2em]">
            Referenced analyses
          </p>
          <ul className="space-y-1">
            {analyses.map((a) => (
              <li key={a.display_name ?? String(a.form_score) ?? a.requested_at} className="flex justify-between border-b border-border/60 py-1.5 text-sm">
                <span className="text-(--fg)">{a.display_name || "Untitled video"}</span>
                <span className="text-muted-foreground">
                  {a.form_score === null ? "—" : `${a.form_score}/10`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function shortDate(iso: string) {
  return new Date(`${iso.length === 10 ? iso : iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}