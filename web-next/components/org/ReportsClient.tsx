"use client"

import { useState } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { PlusIcon, EyeIcon, TrashIcon, FileTextIcon, DownloadIcon, PencilIcon } from "lucide-react"

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
import ReportBody, { shortDate } from "./ReportBody"
import { downloadCSV } from "@/lib/csv"

import type { ReportRecord, Student } from "@/lib/org"
import { orgCreateReport, orgUpdateReport, orgDeleteReport } from "@/lib/org"
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
  const [editing, setEditing] = useState<ReportRecord | null>(null)
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
  const [editForm, setEditForm] = useState({ report_type: "progress", period_start: "", period_end: "", title: "" })
  const [error, setError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const exportCSV = () => {
    downloadCSV(
      `reports-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["Title", "Type", "Student", "Period start", "Period end", "Generated"],
        ...reports.map((r) => [
          r.title,
          typeLabel(r.report_type),
          r.full_name ?? "Organization",
          r.period_start ?? "",
          r.period_end ?? "",
          r.created_at,
        ]),
      ],
    )
  }

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

  const openEdit = (r: ReportRecord) => {
    setEditForm({
      report_type: r.report_type,
      period_start: r.period_start ?? "",
      period_end: r.period_end ?? "",
      title: r.title,
    })
    setEditError(null)
    setEditing(r)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSubmitting(true)
    setEditError(null)
    try {
      const res = await orgUpdateReport(auth0Id, editing.id, {
        report_type: editForm.report_type,
        period_start: editForm.period_start || undefined,
        period_end: editForm.period_end || undefined,
        title: editForm.title || undefined,
      })
      setReports((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...res.report } : r)))
      toast.success("Report updated")
      setEditing(null)
    } catch (err) {
      setEditError((err as CoachAIError).message ?? "Failed to update report")
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
        <div className="flex items-center gap-2">
          {reports.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <DownloadIcon /> Export
            </Button>
          )}
          <Button size="sm" onClick={() => setGenerateOpen(true)}>
            <PlusIcon /> Generate report
          </Button>
        </div>
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
                    <Link href={`/dashboard/reports/${r.id}`} className="hover:underline">
                      {r.title}
                    </Link>
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
                        className="text-muted-foreground"
                        onClick={() => openEdit(r)}
                        aria-label="Edit report"
                      >
                        <PencilIcon className="size-3.5" />
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

      {/* Edit dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Report</DialogTitle>
            <DialogDescription>
              Updating scope or period regenerates the report content.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_report_title">Title</Label>
                <Input
                  id="edit_report_title"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_report_type">Report type</Label>
                <select
                  id="edit_report_type"
                  value={editForm.report_type}
                  onChange={(e) => setEditForm((f) => ({ ...f, report_type: e.target.value }))}
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
                  <Label htmlFor="edit_period_start">Period start</Label>
                  <Input
                    id="edit_period_start"
                    type="date"
                    value={editForm.period_start}
                    onChange={(e) => setEditForm((f) => ({ ...f, period_start: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit_period_end">Period end</Label>
                  <Input
                    id="edit_period_end"
                    type="date"
                    value={editForm.period_end}
                    onChange={(e) => setEditForm((f) => ({ ...f, period_end: e.target.value }))}
                  />
                </div>
              </div>
              {editError && <p className="text-sm text-(--danger)">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={submitting}>
              {submitting ? <Spinner /> : "Save changes"}
            </Button>
          </DialogFooter>
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