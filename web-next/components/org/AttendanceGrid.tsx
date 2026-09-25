'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  StickyNoteIcon,
  MailIcon,
} from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Spinner } from './Spinner'
import { downloadCSV } from '@/lib/csv'
import EmailAttendanceDialog from './EmailAttendanceDialog'

import type { AttendanceStatus, Student } from '@/lib/org'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  orgAttendance,
  orgUpsertAttendance,
  orgBatchAttendance,
  orgDeleteAttendance,
} from '@/lib/org'
import { toISODate } from '@/lib/date'
import type { CoachAIError } from '@/lib/api'

type GridRecord = {
  student_id: string
  session_date: string
  status: AttendanceStatus
  note?: string | null
}

const STATUSES = ATTENDANCE_STATUSES

const STATUS_META: Record<AttendanceStatus, { color: string; letter: string }> = {
  present: { color: 'var(--color-success)', letter: 'P' },
  late: { color: 'var(--color-warning)', letter: 'L' },
  absent: { color: 'var(--color-destructive)', letter: 'A' },
  excused: { color: 'var(--color-info)', letter: 'E' },
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function keyOf(studentId: string, date: string) {
  return `${studentId}|${date}`
}

export default function AttendanceGrid({
  auth0Id,
  students,
  initialRecords,
}: {
  auth0Id: string
  students: Student[]
  initialRecords: GridRecord[]
}) {
  const today = startOfLocalDay(new Date())
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const roster = students
  const [records, setRecords] = useState<Map<string, AttendanceStatus>>(() =>
    makeMap(initialRecords),
  )
  const [notes, setNotes] = useState<Map<string, string>>(() => makeNotes(initialRecords))
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [dayDialog, setDayDialog] = useState<Date | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [statusDraft, setStatusDraft] = useState<Record<string, AttendanceStatus>>({})
  const [notesSaving, setNotesSaving] = useState(false)
  const [emailAttOpen, setEmailAttOpen] = useState(false)

  const year = month.getFullYear()
  const monthNum = month.getMonth()
  const daysInMonth = new Date(year, monthNum + 1, 0).getDate()
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthNum, i + 1)),
    [year, monthNum, daysInMonth],
  )
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const fetchMonth = async (targetMonth: Date) => {
    setLoading(true)
    try {
      const y = targetMonth.getFullYear()
      const m = targetMonth.getMonth()
      const first = new Date(y, m, 1)
      const last = new Date(y, m + 1, 0)
      const res = await orgAttendance(auth0Id, {
        from: toISODate(first),
        to: toISODate(last),
      })
      setRecords(makeMap(res.records))
      setNotes(makeNotes(res.records))
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to load attendance')
    } finally {
      setLoading(false)
    }
  }

  const nav = (delta: number) => {
    const next = new Date(year, monthNum + delta, 1)
    setMonth(next)
    fetchMonth(next)
  }

  const isToday = (d: Date) => toISODate(d) === toISODate(today)

  const cycle = async (studentId: string, date: Date) => {
    const dateStr = toISODate(date)
    const k = keyOf(studentId, dateStr)
    const current = records.get(k)
    const currentNote = notes.get(k)
    const nextIdx = current ? (STATUSES.indexOf(current) + 1) % (STATUSES.length + 1) : 0
    const next: AttendanceStatus | null = nextIdx < STATUSES.length ? STATUSES[nextIdx] : null

    setSavingKey(k)
    setRecords((prev) => {
      const map = new Map(prev)
      if (next) map.set(k, next)
      else map.delete(k)
      return map
    })

    try {
      if (next === null) {
        const res = await orgDeleteAttendance(auth0Id, studentId, dateStr)
        if (!res.deleted) throw new Error('Failed to clear attendance')
        setNotes((prev) => {
          const map = new Map(prev)
          map.delete(k)
          return map
        })
      } else {
        await orgUpsertAttendance(auth0Id, {
          student_id: studentId,
          session_date: dateStr,
          status: next,
          note: currentNote,
        })
      }
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to save attendance')
      setRecords((prev) => {
        const map = new Map(prev)
        if (current) map.set(k, current)
        else map.delete(k)
        return map
      })
    } finally {
      setSavingKey(null)
    }
  }

  const openDayDialog = (d: Date) => {
    const dateStr = toISODate(d)
    const draft: Record<string, string> = {}
    const statuses: Record<string, AttendanceStatus> = {}
    for (const s of roster) {
      const k = keyOf(s.id, dateStr)
      const existingNote = notes.get(k)
      if (existingNote) draft[s.id] = existingNote
      const st = records.get(k)
      if (st) statuses[s.id] = st
    }
    setNoteDraft(draft)
    setStatusDraft(statuses)
    setDayDialog(d)
  }

  const markRemainingPresent = async (date: Date) => {
    const dateStr = toISODate(date)
    const unmarked = roster.filter((s) => !records.has(keyOf(s.id, dateStr)))
    if (unmarked.length === 0) {
      toast.info('Everyone already has a status for this day')
      return
    }
    setLoading(true)
    try {
      const res = await orgBatchAttendance(
        auth0Id,
        unmarked.map((s) => ({
          student_id: s.id,
          session_date: dateStr,
          status: 'present' as const,
        })),
      )
      setRecords((prev) => {
        const map = new Map(prev)
        for (const r of res.records) map.set(keyOf(r.student_id, r.session_date), r.status)
        return map
      })
      setStatusDraft((prev) => {
        const next = { ...prev }
        for (const s of unmarked) next[s.id] = 'present'
        return next
      })
      setNoteDraft((prev) => {
        const next = { ...prev }
        for (const s of unmarked) next[s.id] = next[s.id] ?? ''
        return next
      })
      toast.success(`Marked ${unmarked.length} student(s) present`)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to mark attendance')
    } finally {
      setLoading(false)
    }
  }

  const saveNotes = async () => {
    if (!dayDialog) return
    const dateStr = toISODate(dayDialog)
    const upserts: { student: Student; status: AttendanceStatus; note: string | null }[] = []
    for (const s of roster) {
      const k = keyOf(s.id, dateStr)
      const currentStatus = records.get(k)
      const draftStatus = statusDraft[s.id]
      const desiredStatus = draftStatus ?? currentStatus
      const existingNote = notes.get(k) ?? ''
      const draftNote = noteDraft[s.id]?.trim() ?? ''
      const noteChanged = draftNote !== existingNote
      const statusChanged = currentStatus !== desiredStatus
      if (!statusChanged && !noteChanged) continue
      upserts.push({
        student: s,
        status: desiredStatus ?? 'present',
        note: noteChanged ? draftNote || null : existingNote || null,
      })
    }
    if (upserts.length === 0) {
      setDayDialog(null)
      return
    }
    setNotesSaving(true)
    try {
      await Promise.all(
        upserts.map((u) =>
          orgUpsertAttendance(auth0Id, {
            student_id: u.student.id,
            session_date: dateStr,
            status: u.status,
            note: u.note ?? undefined,
          }),
        ),
      )
      setRecords((prev) => {
        const map = new Map(prev)
        for (const u of upserts) map.set(keyOf(u.student.id, dateStr), u.status)
        return map
      })
      setNotes((prev) => {
        const map = new Map(prev)
        for (const u of upserts) {
          const k = keyOf(u.student.id, dateStr)
          if (u.note) map.set(k, u.note)
          else map.delete(k)
        }
        return map
      })
      toast.success('Saved')
      setDayDialog(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to save')
    } finally {
      setNotesSaving(false)
    }
  }

  const exportCSV = () => {
    const header = [
      'Student',
      'Sport',
      ...days.map((d) => String(d.getDate())),
      ...ATTENDANCE_STATUSES.map((s) => ATTENDANCE_STATUS_LABELS[s]),
    ]
    const rows = roster.map((s) => {
      const counts = rowCounts(s.id)
      return [
        s.full_name,
        s.sport ?? '',
        ...days.map((d) => {
          const st = records.get(keyOf(s.id, toISODate(d)))
          return st ? STATUS_META[st].letter : ''
        }),
        counts.present,
        counts.late,
        counts.absent,
        counts.excused,
      ]
    })
    downloadCSV(`attendance-${year}-${String(monthNum + 1).padStart(2, '0')}.csv`, [
      header,
      ...rows,
    ])
  }

  const rowCounts = (studentId: string) => {
    const counts: Record<string, number> = { present: 0, late: 0, absent: 0, excused: 0 }
    for (const d of days) {
      const st = records.get(keyOf(studentId, toISODate(d)))
      if (st) counts[st] += 1
    }
    return counts
  }

  const dayCounts = (date: Date) => {
    const dateStr = toISODate(date)
    let marked = 0
    let present = 0
    let late = 0
    for (const s of roster) {
      const st = records.get(keyOf(s.id, dateStr))
      if (st) {
        marked += 1
        if (st === 'present') present += 1
        if (st === 'late') late += 1
      }
    }
    return { marked, present, late }
  }

  const dialogDateStr = dayDialog ? toISODate(dayDialog) : ''
  const dialogMarked = dayDialog
    ? roster.filter((s) => records.has(keyOf(s.id, dialogDateStr)))
    : []
  const dialogUnmarked = roster.length - dialogMarked.length

  if (roster.length === 0) {
    return (
      <div className="border-border bg-card rounded-[6px] border p-16 text-center">
        <p className="mb-2 text-body text-muted-foreground">
          Add students to your roster before marking attendance.
        </p>
        <Link
          href="/dashboard/students"
          className="text-meta text-primary transition-colors hover:text-primary hover:underline"
        >
          Go to roster →
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Month header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => nav(-1)}
            aria-label="Previous month"
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => nav(1)} aria-label="Next month">
            <ChevronRightIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
              fetchMonth(new Date(today.getFullYear(), today.getMonth(), 1))
            }}
          >
            Today
          </Button>
        </div>
        <p className="text-lead font-semibold text-foreground">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-muted-foreground" />}
        </p>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-meta sm:flex">
            {STATUSES.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: STATUS_META[s].color }}
                />
                {ATTENDANCE_STATUS_LABELS[s]}
              </span>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setEmailAttOpen(true)}>
            <MailIcon /> Email sheet
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <DownloadIcon /> Export
          </Button>
        </div>
      </div>

      <div className="border-border overflow-x-auto rounded-[6px] border">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-background/95 px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Student
              </th>
              {days.map((d) => {
                const counts = dayCounts(d)
                const noteCount = roster.reduce((acc, s) => {
                  const k = keyOf(s.id, toISODate(d))
                  return acc + (records.has(k) && notes.has(k) ? 1 : 0)
                }, 0)
                return (
                  <th key={d.getTime()} className="px-0.5 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => openDayDialog(d)}
                      title="Open day — mark present or add notes"
                      className={`relative flex h-9 w-8 flex-col items-center justify-center rounded-[4px] border border-transparent transition-colors duration-150 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                        isToday(d) ? 'border-transparent bg-accent font-medium text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      <span className="text-xs leading-none">{d.getDate()}</span>
                      {counts.marked > 0 && (
                        <span className="mt-0.5 flex gap-0.5 leading-none">
                          {counts.present > 0 && (
                            <span
                              className="size-1 rounded-full"
                              style={{ background: STATUS_META.present.color }}
                            />
                          )}
                          {counts.late > 0 && (
                            <span
                              className="size-1 rounded-full"
                              style={{ background: STATUS_META.late.color }}
                            />
                          )}
                        </span>
                      )}
                      {noteCount > 0 && (
                        <StickyNoteIcon className="absolute -top-1 -right-1 size-2.5 text-muted-foreground" />
                      )}
                    </button>
                  </th>
                )
              })}
              <th className="px-3 py-2.5 text-right text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Month
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((s) => {
              const counts = rowCounts(s.id)
              return (
                <tr
                  key={s.id}
                  className="border-border hover:bg-accent/50 border-b transition-colors duration-150 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_56px]"
                >
                  <td className="sticky left-0 z-10 bg-background/95 max-w-44 px-4 py-1.5">
                    <a href={`/dashboard/students/${s.id}`} className="hover:underline">
                      <span className="truncate font-medium text-foreground">{s.full_name}</span>
                      {s.sport ? (
                        <span className="text-muted-foreground ml-1 truncate text-meta">
                          {s.sport}
                        </span>
                      ) : null}
                    </a>
                  </td>
                  {days.map((d) => {
                    const dateStr = toISODate(d)
                    const k = keyOf(s.id, dateStr)
                    const st = records.get(k)
                    const meta = st ? STATUS_META[st] : null
                    const hasNote = records.has(k) && notes.has(k)
                    return (
                      <td key={d.getTime()} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => cycle(s.id, d)}
                          title={
                            st
                              ? `${st ? ATTENDANCE_STATUS_LABELS[st] : ''}${hasNote ? ` · ${notes.get(k)}` : ''} — click to change`
                              : 'Click to mark present'
                          }
                          disabled={savingKey === k}
                          className="relative flex h-8 w-8 items-center justify-center rounded-[4px] border border-border/60 text-label font-semibold transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
                          style={
                            meta
                              ? {
                                  background: meta.color,
                                  color: 'var(--color-background)',
                                  borderColor: meta.color,
                                }
                              : isToday(d)
                                ? {
                                    background: 'var(--color-muted)',
                                    color: 'var(--color-muted-foreground)',
                                  }
                                : {
                                    background: 'transparent',
                                    color: 'var(--color-muted-foreground)',
                                  }
                          }
                        >
                          {meta ? meta.letter : isToday(d) ? '•' : ''}
                          {hasNote && (
                            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-foreground" />
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 text-right">
                    <span
                      className="text-meta tabular-nums text-muted-foreground"
                      title={`Present ${counts.present} · Late ${counts.late} · Absent ${counts.absent} · Excused ${counts.excused}`}
                    >
                      {counts.present}/{daysInMonth}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-3 text-meta">
        Click a cell to cycle statuses: present → late → absent → excused → clear. Click a date to
        mark the day or add per-student notes.
      </p>

      {/* Day dialog: notes + batch mark */}
      <Dialog open={Boolean(dayDialog)} onOpenChange={(open) => !open && setDayDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dayDialog?.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </DialogTitle>
            <DialogDescription>
              {dialogMarked.length} of {roster.length} marked
              {dialogUnmarked > 0 ? ` · ${dialogUnmarked} without a status` : ''}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {dialogUnmarked > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => dayDialog && markRemainingPresent(dayDialog)}
              >
                {loading ? <Spinner /> : 'Mark remaining present'}
              </Button>
            )}

            <div className="grid gap-3">
              {roster.map((s) => {
                const k = keyOf(s.id, dialogDateStr)
                const st = records.get(k)
                return (
                  <div key={s.id} className="grid gap-1.5">
                    <div className="flex items-center gap-2 text-body">
                      <select
                        value={statusDraft[s.id] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value as AttendanceStatus
                          setStatusDraft((prev) => {
                            const next = { ...prev }
                            if (v) next[s.id] = v
                            else delete next[s.id]
                            return next
                          })
                        }}
                        className={`h-7 rounded-[6px] border px-1.5 text-label font-semibold ${
                          st
                            ? 'text-background'
                            : 'text-muted-foreground border-border/60 bg-transparent'
                        }`}
                        style={
                          st
                            ? {
                                background: STATUS_META[st].color,
                                borderColor: STATUS_META[st].color,
                              }
                            : undefined
                        }
                        title="Status for this day"
                      >
                        <option value="">—</option>
                        {STATUSES.map((opt) => (
                          <option key={opt} value={opt}>
                            {ATTENDANCE_STATUS_LABELS[opt]}
                          </option>
                        ))}
                      </select>
                      <span className="text-foreground">{s.full_name}</span>
                      {!st && <span className="text-muted-foreground text-meta">not yet marked</span>}
                    </div>
                    <Input
                      value={noteDraft[s.id] ?? ''}
                      onChange={(e) =>
                        setNoteDraft((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      placeholder="Add a note (e.g. injured, arrived late)…"
                      className="h-8 text-body"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDayDialog(null)}>
              Cancel
            </Button>
            <Button onClick={saveNotes} disabled={notesSaving}>
              {notesSaving ? <Spinner /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email attendance */}
      <EmailAttendanceDialog
        auth0Id={auth0Id}
        open={emailAttOpen}
        onOpenChange={setEmailAttOpen}
        from={toISODate(new Date(year, monthNum, 1))}
        to={toISODate(new Date(year, monthNum + 1, 0))}
      />
    </div>
  )
}

function makeMap(records: GridRecord[]): Map<string, AttendanceStatus> {
  return new Map(records.map((r) => [keyOf(r.student_id, r.session_date), r.status]))
}

function makeNotes(records: GridRecord[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of records) {
    if (r.note) map.set(keyOf(r.student_id, r.session_date), r.note)
  }
  return map
}
