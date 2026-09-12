"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/9ui/ui/button"
import { Spinner } from "./Spinner"
import EventFormDialog from "./EventFormDialog"

import type { ScheduleEvent } from "@/lib/org"
import { orgSchedule, orgDeleteEvent } from "@/lib/org"
import type { CoachAIError } from "@/lib/api"

const TYPES = ["practice", "match", "tournament", "meeting", "other"] as const

const TYPE_META: Record<
  ScheduleEvent["event_type"],
  { color: string; bg: string; border: string; label: string }
> = {
  practice: {
    color: "var(--color-info)",
    bg: "rgba(107, 147, 201, 0.12)",
    border: "var(--color-info-border)",
    label: "Practice",
  },
  match: {
    color: "var(--color-danger)",
    bg: "rgba(200, 0, 60, 0.12)",
    border: "var(--color-danger-border)",
    label: "Match",
  },
  tournament: {
    color: "var(--color-warning)",
    bg: "rgba(224, 179, 65, 0.12)",
    border: "var(--color-warning-border)",
    label: "Tournament",
  },
  meeting: {
    color: "var(--color-success)",
    bg: "rgba(111, 191, 145, 0.12)",
    border: "var(--color-success-border)",
    label: "Meeting",
  },
  other: {
    color: "var(--color-muted-foreground)",
    bg: "rgba(240, 235, 225, 0.06)",
    border: "var(--color-border)",
    label: "Other",
  },
}

function localISO(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

function localDateTimeKey(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return localISO(d)
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export default function ScheduleClient({
  auth0Id,
  initialEvents,
}: {
  auth0Id: string
  initialEvents: ScheduleEvent[]
}) {
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [events, setEvents] = useState<ScheduleEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null)
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined)

  const year = month.getFullYear()
  const monthNum = month.getMonth()
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  const cells = useMemo(() => {
    const firstDay = new Date(year, monthNum, 1)
    const daysInMonth = new Date(year, monthNum + 1, 0).getDate()
    const offset = firstDay.getDay()
    const blanks = Array.from({ length: offset }, () => null)
    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, monthNum, i + 1)
      return { key: localISO(date), date, events: [] as ScheduleEvent[] }
    })
    return [...blanks, ...dayCells] as ({ key: string; date: Date; events: ScheduleEvent[] } | null)[]
  }, [year, monthNum])

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    for (const ev of events) {
      const k = localDateTimeKey(ev.starts_at)
      const list = map.get(k) ?? []
      list.push(ev)
      map.set(k, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return map
  }, [events])

  const fetchMonth = async (target: Date) => {
    setLoading(true)
    try {
      const from = new Date(target.getFullYear(), target.getMonth(), 1)
      const to = new Date(target.getFullYear(), target.getMonth() + 1, 0)
      const res = await orgSchedule(auth0Id, { from: new Date(`${from.getFullYear()}-${from.getMonth() + 1}-01T00:00:00`).toISOString(), to: new Date(`${to.getFullYear()}-${to.getMonth() + 1}-${to.getDate()}T23:59:59`).toISOString() })
      setEvents(res.events)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to load schedule")
    } finally {
      setLoading(false)
    }
  }

  const nav = (delta: number) => {
    const next = new Date(year, monthNum + delta, 1)
    setMonth(next)
    fetchMonth(next)
  }

  const openCreate = (date: Date) => {
    setEditingEvent(null)
    setInitialDate(localISO(date))
    setDialogOpen(true)
  }

  const openEdit = (ev: ScheduleEvent, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEditingEvent(ev)
    setInitialDate(undefined)
    setDialogOpen(true)
  }

  const onSaved = (ev: ScheduleEvent) => {
    setEvents((prev) => {
      const idx = prev.findIndex((p) => p.id === ev.id)
      if (idx === -1) return [...prev, ev]
      const copy = [...prev]
      copy[idx] = ev
      return copy
    })
  }

  const onDelete = async (ev: ScheduleEvent) => {
    try {
      await orgDeleteEvent(auth0Id, ev.id)
      setEvents((prev) => prev.filter((p) => p.id !== ev.id))
      toast.success("Event deleted")
      setDialogOpen(false)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to delete event")
    }
  }

  const todayKey = today.toDateString()

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
              const now = new Date()
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
              fetchMonth(new Date(now.getFullYear(), now.getMonth(), 1))
            }}
          >
            Today
          </Button>
        </div>
        <p className="font-serif text-xl text-(--fg)">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-(--cream-40)" />}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 text-xs">
            {TYPES.map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-(--cream-40)">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: TYPE_META[t].color }}
                />
                {TYPE_META[t].label}
              </span>
            ))}
          </div>
          <Button size="sm" onClick={() => openCreate(new Date())}>
            <PlusIcon /> Add event
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAY_LABELS.map((w) => (
            <div
              key={w}
              className="text-muted-foreground bg-muted/50 py-2 text-center text-[0.6rem] font-normal uppercase tracking-[0.15em]"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`blank-${idx}`} className="border-border bg-background/40 min-h-28 border-b border-r p-1.5" />
            const { date, key } = cell
            const dayEvents = byDay.get(key) ?? []
            const isToday = date.toDateString() === todayKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => openCreate(date)}
                className={`border-border group min-h-28 cursor-pointer border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/40 ${
                  isToday ? "bg-(--success)/5 border-(--success-border)" : ""
                }`}
              >
                <span
                  className={`mb-1 inline-flex size-5 items-center justify-center rounded text-xs ${
                    isToday ? "bg-(--success) font-bold text-background" : "text-(--cream-40)"
                  }`}
                >
                  {date.getDate()}
                </span>
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => {
                    const meta = TYPE_META[ev.event_type] ?? TYPE_META.other
                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => openEdit(ev, e)}
                        title={ev.title}
                        className="truncate rounded px-1.5 py-0.5 text-[0.6rem] leading-tight"
                        style={{
                          color: meta.color,
                          background: meta.bg,
                          border: `1px solid ${meta.border}`,
                        }}
                      >
                        <span className="font-semibold">
                          {ev.starts_at.slice(11, 16)}
                        </span>{" "}
                        {ev.title}
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <span className="text-muted-foreground block px-1 text-[0.6rem]">
                      +{dayEvents.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {events.length === 0 && (
        <p className="text-muted-foreground mt-4 text-xs">
          No events in {monthLabel}. Click any day to add one.
        </p>
      )}

      <EventFormDialog
        key={editingEvent?.id ?? `new-${initialDate ?? "none"}`}
        auth0Id={auth0Id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editingEvent}
        initialDate={initialDate}
        onSaved={onSaved}
        onDelete={onDelete}
      />
    </div>
  )
}