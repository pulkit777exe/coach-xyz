'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  PlusIcon,
  SearchIcon,
  PencilIcon,
  TrashIcon,
  MoreHorizontalIcon,
  DownloadIcon,
  UserPlusIcon,
  MailIcon,
  UploadIcon,
} from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import StatusPill from '@/components/org/StatusPill'
import { Checkbox } from '@/components/9ui/ui/checkbox'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import { downloadCSV, parseCSV } from '@/lib/csv'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/9ui/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/9ui/ui/avatar'
import { Input } from '@/components/9ui/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Spinner } from './Spinner'
import EmptyState from './EmptyState'
import StudentFormDialog from './StudentFormDialog'
import InvitePlayersDialog from './InvitePlayersDialog'

import type { Student, StudentImportResult, StudentImportRow } from '@/lib/org'
import {
  orgDeleteStudent,
  orgUpdateStudent,
  orgStudents,
  orgImportStudents,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
} from '@/lib/org'
import { formatDateMed } from '@/lib/date'
import type { CoachAIError } from '@/lib/api'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/15 text-success',
  inactive: 'bg-warning/15 text-warning',
  transferred: 'bg-muted text-muted-foreground',
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

const IMPORT_COLUMN_FIELDS = [
  'full_name',
  'email',
  'phone',
  'sport',
  'position',
  'jersey_number',
  'date_of_birth',
  'gender',
  'guardian_name',
  'guardian_phone',
  'notes',
  'status',
  'joined_on',
] as const

const IMPORT_COLUMN_ALIASES: Record<string, string> = {
  'full name': 'full_name',
  name: 'full_name',
  student: 'full_name',
  'student name': 'full_name',
  email: 'email',
  phone: 'phone',
  'phone number': 'phone',
  sport: 'sport',
  position: 'position',
  jersey: 'jersey_number',
  'jersey number': 'jersey_number',
  'jersey #': 'jersey_number',
  dob: 'date_of_birth',
  'date of birth': 'date_of_birth',
  gender: 'gender',
  'guardian name': 'guardian_name',
  'guardian phone': 'guardian_phone',
  notes: 'notes',
  status: 'status',
  joined: 'joined_on',
  'joined on': 'joined_on',
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ')

const toJerseyNumber = (value: string): string | number =>
  /^\d+(\.\d+)?$/.test(value) ? Number(value) : value

/** Maps raw CSV cells to import rows: header-aware when the first row contains
 *  known column names, otherwise positional in roster-export order. */
function csvToImportRows(csv: string): StudentImportRow[] {
  const records = parseCSV(csv)
  if (!records.length) return []

  const header = records[0].map(normalizeHeader)
  const hasHeader = header.some((h) => IMPORT_COLUMN_ALIASES[h])
  const mapping: (string | null)[] = hasHeader
    ? header.map((h) => IMPORT_COLUMN_ALIASES[h] ?? null)
    : []
  const body = hasHeader ? records.slice(1) : records

  return body
    .map((cells) => {
      const row: StudentImportRow = {}
      cells.forEach((cell, idx) => {
        const field = hasHeader ? mapping[idx] : IMPORT_COLUMN_FIELDS[idx]
        if (!field) return
        const value = cell.trim()
        if (value === '') return
        ;(row as Record<string, string | number>)[field] =
          field === 'jersey_number' ? toJerseyNumber(value) : value
      })
      return row
    })
    .filter((r) => Object.keys(r).length > 0)
}

function StudentImportDialog({
  open,
  onOpenChange,
  auth0Id,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  auth0Id: string
  onImported: () => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<StudentImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StudentImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setText('')
    setFileName(null)
    setRows([])
    setResult(null)
    setError(null)
  }

  const applyText = (value: string) => {
    setText(value)
    const parsed = csvToImportRows(value)
    setRows(parsed)
    setResult(null)
    setError(parsed.length ? null : 'No rows found — paste CSV text or pick a .csv file.')
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    applyText(await file.text())
  }

  const runImport = async () => {
    if (!rows.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await orgImportStudents(auth0Id, rows)
      setResult(res)
      if (res.imported > 0) onImported()
      if (res.imported === 0 && res.failed.length > 0) {
        toast.error('No rows imported — review the errors below')
      }
    } catch (err) {
      setError((err as CoachAIError).message ?? 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import students from CSV</DialogTitle>
          <DialogDescription>
            Upload a .csv or paste rows. The first row is matched against known column headers (Full
            name, Email, Status, &hellip;); otherwise columns are read in roster export order. Bad
            rows are skipped individually &mdash; the rest still import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="import-file"
              className="border-border bg-background text-muted-foreground hover:text-foreground flex h-9 cursor-pointer items-center gap-2 rounded-[6px] border px-3 text-[14px]"
            >
              <UploadIcon className="size-4" />
              Choose CSV file
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFile}
              />
            </Label>
            {fileName ? (
              <span className="text-muted-foreground truncate text-xs">{fileName}</span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="import-paste" className="text-[14px] font-medium">
              …or paste CSV
            </Label>
            <Textarea
              id="import-paste"
              value={text}
              onChange={(e) => applyText(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder={'full_name,email,status\nAlex Rivera,a@x.com,active'}
            />
          </div>

          {rows.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {rows.length} row(s) parsed — first {Math.min(rows.length, 8)} shown
              </p>
              <div className="border-border max-h-48 overflow-auto rounded-[6px] border">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Sport</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="text-foreground px-3 py-1.5">{r.full_name ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.email ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.sport ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.status ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

          {result ? (
            <div className="border-border bg-muted/40 space-y-1 rounded-[6px] border p-3 text-[13px]">
              <p className="text-foreground font-medium">{result.imported} imported</p>
              {result.duplicates_skipped > 0 ? (
                <p className="text-muted-foreground">
                  {result.duplicates_skipped} duplicate(s) skipped by email
                </p>
              ) : null}
              {result.failed.length > 0 ? (
                <ul className="text-muted-foreground max-h-32 list-disc space-y-0.5 overflow-auto pl-5">
                  {result.failed.map((f) => (
                    <li key={`${f.row_index}-${f.reason}`}>
                      Row {f.row_index + 1}: {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button onClick={runImport} disabled={busy || rows.length === 0}>
            {busy ? <Spinner /> : <UploadIcon />} Import{' '}
            {rows.length > 0 ? `${rows.length} student(s)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function StudentsClient({
  auth0Id,
  initialStudents,
  sports,
  teams,
}: {
  auth0Id: string
  initialStudents: Student[]
  sports: string[]
  teams: { id: string; name: string }[]
}) {
  const [students, setStudents] = useState<Student[]>(initialStudents)
  const [search, setSearch] = useState('')
  const [sport, setSport] = useState('')
  const [status, setStatus] = useState('')
  const [teamId, setTeamId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deleting, setDeleting] = useState<Student | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForBulk, setInviteForBulk] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter((s) => {
      if (q && !`${s.full_name} ${s.email ?? ''} ${s.sport ?? ''}`.toLowerCase().includes(q))
        return false
      if (sport && s.sport !== sport) return false
      if (status && s.status !== status) return false
      if (teamId && (s.team_id ?? '') !== teamId) return false
      return true
    })
  }, [students, search, sport, status, teamId])

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

  const applyBulkStatus = async (nextStatus: Student['status']) => {
    if (!selectedIds.length) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => orgUpdateStudent(auth0Id, id, { status: nextStatus })),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      setStudents((prev) =>
        prev.map((p) => (selected.has(p.id) ? { ...p, status: nextStatus } : p)),
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
      const results = await Promise.allSettled(
        selectedIds.map((id) => orgDeleteStudent(auth0Id, id)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      setStudents((prev) => prev.filter((p) => !selected.has(p.id)))
      if (ok > 0) toast.success(`Removed ${ok} student(s)`)
      if (ok < selectedIds.length)
        toast.error(`${selectedIds.length - ok} student(s) could not be removed`)
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const exportCSV = () => {
    downloadCSV(`roster-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        'Full name',
        'Email',
        'Phone',
        'Sport',
        'Position',
        'Jersey #',
        'Status',
        'Joined',
        'Date of birth',
        'Gender',
        'Guardian name',
        'Guardian phone',
        'Notes',
      ],
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
    ])
  }

  const openCreate = () => {
    setEditingStudent(null)
    setDialogOpen(true)
  }

  const openEdit = (s: Student) => {
    setEditingStudent(s)
    setDialogOpen(true)
  }

  const selectedStudents = filtered.filter((s) => selected.has(s.id))
  const openInvite = (fromBulk: boolean) => {
    setInviteForBulk(fromBulk)
    setInviteOpen(true)
  }

  const onCreated = (s: Student) => {
    setStudents((prev) => [s, ...prev])
  }

  const onUpdated = (s: Student) => {
    setStudents((prev) => prev.map((p) => (p.id === s.id ? s : p)))
  }

  const refreshStudents = async () => {
    const res = await orgStudents(auth0Id)
    setStudents(res.students)
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
      toast.error((err as CoachAIError).message ?? 'Failed to delete student')
    } finally {
      setDeleteBusy(false)
    }
  }

  const sportsForForm = sports.length
    ? sports
    : ['Academy', 'Tennis', 'Cricket', 'Football', 'Basketball']

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
          <Select
            items={{ __all: 'All sports', ...Object.fromEntries(sportsForForm.map((s) => [s, s])) }}
            value={sport || '__all'}
            onValueChange={(v) => setSport(v === '__all' ? '' : typeof v === 'string' ? v : '')}
          >
            <SelectTrigger aria-label="Filter by sport" className="w-36">
              <SelectValue placeholder="All sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All sports</SelectItem>
              {sportsForForm.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={{
              __all: 'All statuses',
              ...Object.fromEntries(STUDENT_STATUSES.map((s) => [s, STUDENT_STATUS_LABELS[s]])),
            }}
            value={status || '__all'}
            onValueChange={(v) => setStatus(v === '__all' ? '' : typeof v === 'string' ? v : '')}
          >
            <SelectTrigger aria-label="Filter by status" className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All statuses</SelectItem>
              {STUDENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STUDENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={{ __all: 'All teams', ...Object.fromEntries(teams.map((t) => [t.id, t.name])) }}
            value={teamId || '__all'}
            onValueChange={(v) => setTeamId(v === '__all' ? '' : typeof v === 'string' ? v : '')}
          >
            <SelectTrigger aria-label="Filter by team" className="w-36">
              <SelectValue placeholder="All teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <DownloadIcon /> Export
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openInvite(false)}>
            <UserPlusIcon />
            Invite
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <UploadIcon />
            Import
          </Button>
          <Button size="sm" onClick={openCreate}>
            <PlusIcon />
            Add student
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="border-border bg-card mb-4 flex flex-wrap items-center gap-2 rounded-[6px] border px-3 py-2">
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={() => applyBulkStatus('active')}
            >
              Mark active
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={() => applyBulkStatus('inactive')}
            >
              Mark inactive
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={() => applyBulkStatus('transferred')}
            >
              Mark transferred
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={() => openInvite(true)}
            >
              <MailIcon /> Invite
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkBusy}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${selectedIds.length} selected student(s)? This cannot be undone.`,
                  )
                ) {
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
      <div className="overflow-hidden rounded-[6px] border border-border bg-card">
        {filtered.length === 0 ? (
          <EmptyState
            title={students.length === 0 ? 'No students yet' : 'No matching students'}
            description={
              students.length === 0
                ? 'Add your first student to get started.'
                : 'Try clearing your search or filters.'
            }
            action={
              students.length === 0 ? (
                <Button size="sm" onClick={openCreate}>
                  <PlusIcon />
                  Add student
                </Button>
              ) : undefined
            }
          />
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5">
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={selectedIds.length > 0 && !allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all students"
                  />
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Student
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Sport
                </th>
                <th className="hidden px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                  Team
                </th>
                <th className="hidden px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                  Position
                </th>
                <th className="hidden px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                  Joined
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-accent/50 [content-visibility:auto] [contain-intrinsic-size:auto_56px]"
                >
                  <td className="px-4 py-2.5">
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggleSelect(s.id)}
                      aria-label={`Select ${s.full_name}`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/students/${s.id}`} className="flex items-center gap-3">
                      <Avatar className="border-border size-9 border">
                        <AvatarImage src={undefined} alt="" />
                        <AvatarFallback className="bg-muted text-muted-foreground text-[12px]">
                          {initials(s.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{s.full_name}</p>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {s.email || s.phone || '—'}
                        </p>
                        {s.account_auth0_id && (
                          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                            • linked to player account
                          </p>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.sport ? (
                      <StatusPill tone="gray">{s.sport}</StatusPill>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {s.jersey_number ? (
                      <span className="ml-1 text-[13px] tabular-nums text-muted-foreground">
                        #{s.jersey_number}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    {(() => {
                      const team = teams.find((t) => t.id === s.team_id)
                      return team ? (
                        <StatusPill tone="gray">{team.name}</StatusPill>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    })()}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                    {s.position || '—'}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground tabular-nums md:table-cell">
                    {s.joined_on ? formatDateMed(s.joined_on) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex h-[20px] items-center rounded-full px-2 font-medium leading-none ${STATUS_STYLE[s.status] ?? 'bg-muted text-muted-foreground'}`}
                      style={{ fontSize: 11 }}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
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
        key={editingStudent?.id ?? 'new'}
        auth0Id={auth0Id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        student={editingStudent}
        sports={sports}
        teams={teams}
        onCreated={onCreated}
        onUpdated={onUpdated}
      />

      {/* Delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.full_name}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the student and their attendance records. Past reports
              keep a snapshot. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : 'Delete student'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite players */}
      <InvitePlayersDialog
        auth0Id={auth0Id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        selectedEmails={
          inviteForBulk
            ? selectedStudents.map((s) => s.email).filter((e): e is string => Boolean(e))
            : undefined
        }
        selectedStudentIds={inviteForBulk ? selectedStudents.map((s) => s.id) : undefined}
      />

      {/* Import students */}
      <StudentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        auth0Id={auth0Id}
        onImported={() => {
          refreshStudents()
          toast.success('Roster updated')
        }}
      />
    </div>
  )
}
