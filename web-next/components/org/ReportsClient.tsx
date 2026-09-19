"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { PlusIcon, EyeIcon, TrashIcon, FileTextIcon, DownloadIcon, PencilIcon, MailIcon, SparklesIcon } from "lucide-react"

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
import ReportBody from "./ReportBody"
import EmailReportDialog from "./EmailReportDialog"
import { downloadCSV } from "@/lib/csv"
import { formatDateMed } from "@/lib/date"

import type { ReportRecord, Student, ReportType } from "@/lib/org"
import {
  orgCreateReport,
  orgUpdateReport,
  orgDeleteReport,
  REPORT_TYPES,
  REPORT_TYPE_LABELS,
} from "@/lib/org"
import { orgGenerateAiReport, orgAiReportStatus } from "@/lib/aiReports"
import type { AiReportJobPoll } from "@/lib/aiReports"
import type { CoachAIError } from "@/lib/api"

const TYPE_BADGE: Record<string, string> = {
  progress: "border-(--info-border) text-(--info)",
  attendance: "border-(--warning-border) text-(--warning)",
  performance: "border-(--success-border) text-(--success)",
  monthly: "border-(--danger-border) text-destructive",
}

function typeLabel(t: string) {
  return REPORT_TYPE_LABELS[t as ReportType] ?? t
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
  const [emailing, setEmailing] = useState<ReportRecord | null>(null)
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

  // ── One-click AI report generation state ─────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPending, setAiPending] = useState<{ report_job_id: string } | null>(null)
  const [aiJob, setAiJob] = useState<AiReportJobPoll | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiForm, setAiForm] = useState({
    student_id: "all",
    report_type: "progress",
    period_start: "",
    period_end: "",
    title: "",
  })

  const resetAiForm = () => {
    setAiForm({ student_id: "all", report_type: "progress", period_start: "", period_end: "", title: "" })
  }

  const closeAi = () => {
    setAiOpen(false)
    setAiPending(null)
    setAiJob(null)
    setAiError(null)
    setAiBusy(false)
  }

  useEffect(() => {
    if (!aiPending) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await orgAiReportStatus(auth0Id, aiPending.report_job_id)
        if (cancelled) return
        setAiJob(res)
        if (res.status === "done" && res.report) {
          setReports((prev) => (prev.some((r) => r.id === res.report!.id) ? prev : [res.report!, ...prev]))
          toast.success("AI report generated")
          setAiPending(null)
          setAiOpen(false)
          resetAiForm()
        } else if (res.status === "failed") {
          setAiPending(null)
          setAiError("AI report generation failed. Please try again.")
        }
      } catch (err) {
        if (cancelled) return
        setAiPending(null)
        setAiError((err as CoachAIError).message ?? "Failed to check AI report status")
      }
    }

    const interval = setInterval(poll, 2500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [auth0Id, aiPending])

  const generateAi = async () => {
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await orgGenerateAiReport(auth0Id, {
        student_id: aiForm.student_id !== "all" ? aiForm.student_id : undefined,
        report_type: aiForm.report_type,
        period_start: aiForm.period_start || undefined,
        period_end: aiForm.period_end || undefined,
        title: aiForm.title || undefined,
      })
      setAiPending({ report_job_id: res.report_job_id })
    } catch (err) {
      setAiError((err as CoachAIError).message ?? "Failed to start AI report")
    } finally {
      setAiBusy(false)
    }
  }

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
        period_start: editForm.period_start || null,
        period_end: editForm.period_end || null,
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

  const studentById = (id: string | null) => (id ? students.find((s) => s.id === id) : undefined)

const openEmail = (r: ReportRecord) => {
    setEmailing(r)
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
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)} disabled={Boolean(aiPending)}>
            <SparklesIcon /> Generate with AI
          </Button>
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
          <p className="text-muted-foreground mt-1 text-xs">
            Generate progress, attendance, or performance reports for your students.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards (md and up use the table below) */}
          <ul className="space-y-3 md:hidden">
            {reports.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/reports/${r.id}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {r.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.full_name || "Organization"} ·{" "}
                      {r.period_start
                        ? `${formatDateMed(r.period_start)} → ${formatDateMed(r.period_end ?? r.period_start)}`
                        : "All time"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <Badge className={(TYPE_BADGE[r.report_type] ?? "border-border") + " shrink-0 border"}>
                    {typeLabel(r.report_type)}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setViewing(r)} aria-label="View report">
                    <EyeIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    onClick={() => openEmail(r)}
                    aria-label="Email report"
                  >
                    <MailIcon className="size-3.5" />
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
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleting(r)}
                    aria-label="Delete report"
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden border-border overflow-hidden rounded-lg border md:block">
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
                <tr key={r.id} className="hover:bg-accent/50 border-border border-b last:border-0 [content-visibility:auto] [contain-intrinsic-size:auto_56px]">
                  <td className="px-4 py-3 font-medium text-foreground">
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
                    {r.period_start ? `${formatDateMed(r.period_start)} → ${formatDateMed(r.period_end ?? r.period_start)}` : "All time"}
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
                        onClick={() => openEmail(r)}
                        aria-label="Email report"
                      >
                        <MailIcon className="size-3.5" />
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
                        className="text-muted-foreground hover:text-destructive"
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
        </>
      )}

      {/* AI Generate dialog */}
      <Dialog open={aiOpen} onOpenChange={(open) => (open ? setAiOpen(true) : closeAi())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{aiPending ? "Generating AI report" : "Generate with AI"}</DialogTitle>
            <DialogDescription>
              {aiPending
                ? "CoachXYZ is analyzing your data and writing the report — usually under a minute."
                : "CoachXYZ reads your sessions and writes the report automatically."}
            </DialogDescription>
          </DialogHeader>
          {aiPending ? (
            <div className="grid gap-4">
              <div className="border-border bg-muted/30 flex items-center gap-3 rounded-md border px-4 py-3">
                <Spinner className="text-primary" />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    Generating {aiForm.title ? `“${aiForm.title}”` : (aiForm.student_id !== "all" ? "student report" : "organization report")}…
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {aiJob?.status === "running"
                      ? "Writing the report"
                      : aiJob?.status === "queued"
                        ? "Waiting for a worker"
                        : "Starting up"}
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                Keep this dialog open — the finished report lands in your list automatically.
              </p>
              {aiError && <p className="text-sm text-destructive">{aiError}</p>}
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ai_report_student">Student</Label>
                <select
                  id="ai_report_student"
                  value={aiForm.student_id}
                  onChange={(e) => setAiForm((f) => ({ ...f, student_id: e.target.value }))}
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
                  {aiForm.student_id === "all" ? "Covers the whole organization." : "Scoped to a single student."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai_report_type">Report type</Label>
                <select
                  id="ai_report_type"
                  value={aiForm.report_type}
                  onChange={(e) => setAiForm((f) => ({ ...f, report_type: e.target.value }))}
                  className="bg-input text-foreground focus-visible:ring-ring/50 border-input focus-visible:border-ring h-9 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
                >
                  {REPORT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {REPORT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="ai_period_start">Period start</Label>
                  <Input
                    id="ai_period_start"
                    type="date"
                    value={aiForm.period_start}
                    onChange={(e) => setAiForm((f) => ({ ...f, period_start: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ai_period_end">Period end</Label>
                  <Input
                    id="ai_period_end"
                    type="date"
                    value={aiForm.period_end}
                    onChange={(e) => setAiForm((f) => ({ ...f, period_end: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai_report_title">Custom title (optional)</Label>
                <Input
                  id="ai_report_title"
                  value={aiForm.title}
                  onChange={(e) => setAiForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Q3 Mid-season Review"
                />
              </div>
              {aiError && <p className="text-sm text-destructive">{aiError}</p>}
            </div>
          )}
          <DialogFooter>
            {aiPending ? (
              <>
                <Button variant="outline" onClick={closeAi}>
                  Stop
                </Button>
                <Button disabled>
                  <Spinner /> Working…
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={closeAi}>
                  Cancel
                </Button>
                <Button onClick={generateAi} disabled={aiBusy}>
                  {aiBusy ? <Spinner /> : "Generate"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
{(REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REPORT_TYPE_LABELS[t]}
                  </option>
                )))}
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
            {error && <p className="text-sm text-destructive">{error}</p>}
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
                  {(REPORT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {REPORT_TYPE_LABELS[t]}
                    </option>
                  )))}
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
              {editError && <p className="text-sm text-destructive">{editError}</p>}
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

      {/* Email report */}
      <EmailReportDialog
        key={emailing?.id ?? "none"}
        auth0Id={auth0Id}
        report={emailing ?? ({} as ReportRecord)}
        open={Boolean(emailing)}
        onOpenChange={(open) => !open && setEmailing(null)}
        defaultEmail={
          emailing ? studentById(emailing.student_id)?.email ?? undefined : undefined
        }
      />

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