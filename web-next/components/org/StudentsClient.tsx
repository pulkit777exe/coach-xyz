"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PlusIcon, SearchIcon, PencilIcon, TrashIcon, MoreHorizontalIcon, DownloadIcon } from "lucide-react"

import { Button } from "@/components/9ui/ui/button"
import { Badge } from "@/components/9ui/ui/badge"
import { Checkbox } from "@/components/9ui/ui/checkbox"
import { downloadCSV } from "@/lib/csv"
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
  DropdownMenuSeparator,
} from "@/components/9ui/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/9ui/ui/avatar"
import { Input } from "@/components/9ui/ui/input"
import { Spinner } from "./Spinner"
import StudentFormDialog from "./StudentFormDialog"

import type { Student } from "@/lib/org"
import { orgDeleteStudent, orgUpdateStudent, STUDENT_STATUSES, STUDENT_STATUS_LABELS } from "@/lib/org"
import { formatDateMed } from "@/lib/date"
import type { CoachAIError } from "@/lib/api"

const STATUS_STYLE: Record<string, string> = {
  active: "border-(--success-border) text-(--success) bg-(--success)",
  inactive: "border-(--warning-border) text-(--warning)",
  transferred: "border-border text-muted-foreground",
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

export default function StudentsClient({
  auth0Id,
  initialStudents,
  sports,
}: {
  auth0Id: string
  initialStudents: Student[]
  sports: string[]
}) {
  const [students, setStudents] = useState<Student[]>(initialStudents)
  const [search, setSearch] = useState("")
  const [sport, setSport] = useState("")
  const [status, setStatus] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deleting, setDeleting] = useState<Student | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter((s) => {
      if (q && !`${s.full_name} ${s.email ?? ""} ${s.sport ?? ""}`.toLowerCase().includes(q)) return false
      if (sport && s.sport !== sport) return false
      if (status && s.status !== status) return false
      return true
    })
  }, [students, search, sport, status])

  const selectedIds = filtered.filter((s) => selected.has(s.id)).map((s) => s.id)
  const allFilteredSelected = filtered.length > 0 && selectedIds.length === filtered.length

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((s) => next.delete(s.id))
      else filtered.forEach((s) => next.add(s.id))
      return next
    })
  }

  const applyBulkStatus = async (nextStatus: Student["status"]) => {
    if (!selectedIds.length) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => orgUpdateStudent(auth0Id, id, { status: nextStatus })),
      )
      const ok = results.filter((r) => r.status === "fulfilled").length
      setStudents((prev) =>
        prev.map((p) =>
          selected.has(p.id) ? { ...p, status: nextStatus } : p,
        ),
      )
      toast.success(`Updated ${ok} student(s) to ${nextStatus}`)
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const confirmBulkDelete = async () => {
    if (!selectedIds.length) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(selectedIds.map((id) => orgDeleteStudent(auth0Id, id)))
      const ok = results.filter((r) => r.status === "fulfilled").length
      setStudents((prev) => prev.filter((p) => !selected.has(p.id)))
      if (ok > 0) toast.success(`Removed ${ok} student(s)`)
      if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} student(s) could not be removed`)
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const exportCSV = () => {
    downloadCSV(
      `roster-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["Full name", "Email", "Phone", "Sport", "Position", "Jersey #", "Status", "Joined", "Date of birth", "Gender", "Guardian name", "Guardian phone", "Notes"],
        ...filtered.map((s) => [
          s.full_name,
          s.email,
          s.phone,
          s.sport,
          s.position,
          s.jersey_number,
          s.status,
          s.joined_on,
          s.date_of_birth,
          s.gender,
          s.guardian_name,
          s.guardian_phone,
          s.notes,
        ]),
      ],
    )
  }

  const openCreate = () => {
    setEditingStudent(null)
    setDialogOpen(true)
  }

  const openEdit = (s: Student) => {
    setEditingStudent(s)
    setDialogOpen(true)
  }

  const onCreated = (s: Student) => {
    setStudents((prev) => [s, ...prev])
  }

  const onUpdated = (s: Student) => {
    setStudents((prev) => prev.map((p) => (p.id === s.id ? s : p)))
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await orgDeleteStudent(auth0Id, deleting.id)
      setStudents((prev) => prev.filter((p) => p.id !== deleting.id))
      toast.success(`${deleting.full_name} removed`)
      setDeleting(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to delete student")
    } finally {
      setDeleteBusy(false)
    }
  }

  const sportsForForm = sports.length ? sports : ["Academy", "Tennis", "Cricket", "Football", "Basketball"]

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2 flex-col sm:flex-row sm:max-w-md">
          <div className="relative flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, sport…"
              className="pl-9"
            />
          </div>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="bg-input text-foreground border-input focus-visible:ring-ring/50 focus-visible:border-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
          >
            <option value="">All sports</option>
            {sportsForForm.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-input text-foreground border-input focus-visible:ring-ring/50 focus-visible:border-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
          >
            <option value="">All statuses</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STUDENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <DownloadIcon /> Export
            </Button>
          )}
          <Button size="sm" onClick={openCreate}>
            <PlusIcon />
            Add student
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="border-border bg-card mb-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <span className="text-muted-foreground text-sm">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => applyBulkStatus("active")}>
              Mark active
            </Button>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => applyBulkStatus("inactive")}>
              Mark inactive
            </Button>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => applyBulkStatus("transferred")}>
              Mark transferred
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkBusy}
              onClick={() => {
                if (window.confirm(`Remove ${selectedIds.length} selected student(s)? This cannot be undone.`)) {
                  confirmBulkDelete()
                }
              }}
            >
              <TrashIcon /> Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border-border overflow-hidden rounded-lg border">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground bg-card p-16 text-center text-sm">
            {students.length === 0
              ? "No students yet. Add your first student to get started."
              : "No students match your filters."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-muted-foreground uppercase">
                <th className="px-4 py-3">
                  <Checkbox checked={allFilteredSelected} indeterminate={selectedIds.length > 0 && !allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Select all students" />
                </th>
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Student
                </th>
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Sport
                </th>
                <th className="hidden px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em] md:table-cell">
                  Position
                </th>
                <th className="hidden px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em] md:table-cell">
                  Joined
                </th>
                <th className="px-4 py-3 text-left font-normal text-[0.65rem] tracking-[0.15em]">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-normal text-[0.65rem] tracking-[0.15em]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-accent/50 border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Select ${s.full_name}`} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/students/${s.id}`} className="flex items-center gap-3">
                      <Avatar className="border-border size-9 border">
                        <AvatarImage src={undefined} alt="" />
                        <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                          {initials(s.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-foreground truncate font-medium">{s.full_name}</p>
                        <p className="text-muted-foreground truncate text-xs">{s.email || s.phone || "—"}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {s.sport ? (
                      <Badge variant="outline" className="border-border text-muted-foreground">
                        {s.sport}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {s.jersey_number ? <span className="text-muted-foreground ml-1 text-xs">#{s.jersey_number}</span> : null}
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-3 md:table-cell">
                    {s.position || "—"}
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-3 md:table-cell">
                    {s.joined_on ? formatDateMed(s.joined_on) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        (STATUS_STYLE[s.status] ?? "border-border text-muted-foreground") + " border"
                      }
                    >
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontalIcon />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          render={
                            <Link href={`/dashboard/students/${s.id}`}>
                              <span className="flex items-center gap-2">
                                <MoreHorizontalIcon className="size-3.5" />
                                View profile
                              </span>
                            </Link>
                          }
                        />
                        <DropdownMenuItem onClick={() => openEdit(s)}>
                          <PencilIcon className="size-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(s)}>
                          <TrashIcon className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit dialog (keyed so the form resets per student) */}
      <StudentFormDialog
        key={editingStudent?.id ?? "new"}
        auth0Id={auth0Id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        student={editingStudent}
        sports={sports}
        onCreated={onCreated}
        onUpdated={onUpdated}
      />

      {/* Delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.full_name}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the student and their attendance records. Past reports keep
              a snapshot. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : "Delete student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}