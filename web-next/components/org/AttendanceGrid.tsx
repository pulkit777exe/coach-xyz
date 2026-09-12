"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/9ui/ui/button"
import { Spinner } from "./Spinner"

import type { AttendanceStatus, Student } from "@/lib/org"
import { orgAttendance, orgUpsertAttendance, orgBatchAttendance, orgDeleteAttendance } from "@/lib/org"
import type { CoachAIError } from "@/lib/api"

type GridRecord = { student_id: string; session_date: string; status: AttendanceStatus }

const STATUSES: AttendanceStatus[] = ["present", "late", "absent", "excused"]

const STATUS_META: Record<AttendanceStatus, { color: string; letter: string; label: string }> = {
  present: { color: "var(--color-success)", letter: "P", label: "Present" },
  late: { color: "var(--color-warning)", letter: "L", label: "Late" },
  absent: { color: "var(--color-destructive)", letter: "A", label: "Absent" },
  excused: { color: "var(--color-info)", letter: "E", label: "Excused" },
}

function toISO(date: Date) {
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${m}-${d}`
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
  const [records, setRecords] = useState<Map<string, AttendanceStatus>>(
    () => makeMap(initialRecords),
  )
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const year = month.getFullYear()
  const monthNum = month.getMonth()
  const daysInMonth = new Date(year, monthNum + 1, 0).getDate()
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthNum, i + 1)),
    [year, monthNum, daysInMonth],
  )
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  const fetchMonth = async (targetMonth: Date) => {
    setLoading(true)
    try {
      const y = targetMonth.getFullYear()
      const m = targetMonth.getMonth()
      const first = new Date(y, m, 1)
      const last = new Date(y, m + 1, 0)
      const res = await orgAttendance(auth0Id, {
        from: toISO(first),
        to: toISO(last),
      })
      setRecords(makeMap(res.records))
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to load attendance")
    } finally {
      setLoading(false)
    }
  }

  const nav = (delta: number) => {
    const next = new Date(year, monthNum + delta, 1)
    setMonth(next)
    fetchMonth(next)
  }

  const isToday = (d: Date) => toISO(d) === toISO(today)

  const cycle = async (studentId: string, date: Date) => {
    const dateStr = toISO(date)
    const k = keyOf(studentId, dateStr)
    const current = records.get(k)
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
        await orgDeleteAttendance(auth0Id, studentId, dateStr).catch(() => null)
      } else {
        await orgUpsertAttendance(auth0Id, {
          student_id: studentId,
          session_date: dateStr,
          status: next,
        })
      }
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to save attendance")
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

  const markAll = async (date: Date) => {
    const dateStr = toISO(date)
    setLoading(true)
    try {
      const res = await orgBatchAttendance(
        auth0Id,
        students.map((s) => ({ student_id: s.id, session_date: dateStr, status: "present" as const })),
      )
      const map = new Map(records)
      for (const r of res.records) {
        if (r.session_date === dateStr) map.set(keyOf(r.student_id, r.session_date), r.status)
      }
      setRecords(map)
      toast.success("Day marked present")
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to mark attendance")
    } finally {
      setLoading(false)
    }
  }

  const rowCounts = (studentId: string) => {
    const counts: Record<string, number> = { present: 0, late: 0, absent: 0, excused: 0 }
    for (const d of days) {
      const st = records.get(keyOf(studentId, toISO(d)))
      if (st) counts[st] += 1
    }
    return counts
  }

  const dayCounts = (date: Date) => {
    const dateStr = toISO(date)
    let marked = 0
    let present = 0
    let late = 0
    for (const s of students) {
      const st = records.get(keyOf(s.id, dateStr))
      if (st) {
        marked += 1
        if (st === "present") present += 1
        if (st === "late") late += 1
      }
    }
    return { marked, present, late }
  }

  if (students.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-16 text-center">
        <p className="text-muted-foreground mb-2 text-sm">
          Add students to your roster before marking attendance.
        </p>
        <Link
          href="/dashboard/students"
          className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg)"
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
          <Button variant="outline" size="icon-sm" onClick={() => nav(-1)} aria-label="Previous month">
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
        <p className="font-serif text-xl text-(--fg)">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-(--cream-40)" />}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-(--cream-40)">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: STATUS_META[s].color }}
              />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border text-muted-foreground">
              <th className="sticky left-0 z-10 bg-background/95 px-4 py-2 text-left text-[0.6rem] font-normal uppercase tracking-[0.15em]">
                Student
              </th>
              {days.map((d) => {
                const counts = dayCounts(d)
                return (
                  <th key={d.getTime()} className="px-0.5 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => markAll(d)}
                      title="Mark all students present"
                      className={`flex h-9 w-8 flex-col items-center justify-center rounded border border-transparent transition-colors hover:border-(--cream-20) ${
                        isToday(d) ? "bg-(--success) text-background" : "text-(--cream-40)"
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
                    </button>
                  </th>
                )
              })}
              <th className="px-3 py-2 text-right text-[0.6rem] font-normal uppercase tracking-[0.15em]">
                Month
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const counts = rowCounts(s.id)
              return (
                <tr key={s.id} className="border-border hover:bg-accent/40 border-b last:border-0">
                  <td className="sticky left-0 z-10 bg-background/95 max-w-44 px-4 py-1.5">
                    <a href={`/dashboard/students/${s.id}`} className="hover:underline">
                      <span className="truncate font-medium text-(--fg)">{s.full_name}</span>
                      {s.sport ? (
                        <span className="text-muted-foreground ml-1 truncate text-xs">
                          {s.sport}
                        </span>
                      ) : null}
                    </a>
                  </td>
                  {days.map((d) => {
                    const dateStr = toISO(d)
                    const k = keyOf(s.id, dateStr)
                    const st = records.get(k)
                    const meta = st ? STATUS_META[st] : null
                    return (
                      <td key={d.getTime()} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => cycle(s.id, d)}
                          title={st ? `${meta ? meta.label : ""} — click to change` : "Click to mark present"}
                          disabled={savingKey === k}
                          className="flex h-8 w-8 items-center justify-center rounded text-[0.65rem] font-semibold border border-border/60 transition-transform hover:scale-105 disabled:opacity-40"
                          style={
                            meta
                              ? {
                                  background: meta.color,
                                  color: "var(--color-background)",
                                  borderColor: meta.color,
                                }
                              : isToday(d)
                                ? { background: "var(--color-muted)", color: "var(--color-muted-foreground)" }
                                : { background: "transparent", color: "var(--color-muted-foreground)" }
                          }
                        >
                          {meta ? meta.letter : isToday(d) ? "•" : ""}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 text-right">
                    <span className="text-xs text-(--cream-40)" title={`Present ${counts.present} · Late ${counts.late} · Absent ${counts.absent} · Excused ${counts.excused}`}>
                      {counts.present}/{daysInMonth}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Click a cell to cycle statuses: present → late → absent → excused → clear. Click a date to
        mark the whole day present.
      </p>
    </div>
  )
}

function makeMap(records: GridRecord[]): Map<string, AttendanceStatus> {
  return new Map(records.map((r) => [keyOf(r.student_id, r.session_date), r.status]))
}