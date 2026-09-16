"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ClockIcon, MapPinIcon } from "lucide-react"

import { Button } from "@/components/9ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/9ui/ui/dialog"
import { Spinner } from "./Spinner"
import EventFormDialog from "./EventFormDialog"
import { downloadCSV } from "@/lib/csv"

import type { EventStatus, ScheduleEvent } from "@/lib/org"
import { orgSchedule, orgDeleteEvent, EVENT_STATUSES, EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from "@/lib/org"
import { toISODate } from "@/lib/date"
import type { CoachAIError } from "@/lib/api"

const TYPE_META: Record<
  ScheduleEvent["event_type"],
  { color: string; bg: string; border: string }
> = {
  practice: {
    color: "var(--color-info)",
    bg: "rgba(107, 147, 201, 0.12)",
    border: "var(--color-info-border)",
  },
  match: {
    color: "var(--color-danger)",
    bg: "rgba(200, 0, 60, 0.12)",
    border: "var(--color-danger-border)",
  },
  tournament: {
    color: "var(--color-warning)",
    bg: "rgba(224, 179, 65, 0.12)",
    border: "var(--color-warning-border)",
  },
  meeting: {
    color: "var(--color-success)",
    bg: "rgba(111, 191, 145, 0.12)",
    border: "var(--color-success-border)",
  },
  other: {
    color: "var(--color-muted-foreground)",
    bg: "rgba(240, 235, 225, 0.06)",
    border: "var(--color-border)",
  },
}

const STATUS_META: Record<EventStatus, { className: string }> = {
  scheduled: { className: "border-(--info-border) text-(--info)" },
  completed: { className: "border-(--success-border) text-(--success)" },
  cancelled: { className: "border-(--danger-border) text-(--danger)" },
}

function localDateTimeKey(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return toISODate(d)
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
  const [statusFilter, setStatusFilter] = useState("")
  const [dayView, setDayView] = useState<Date | null>(null)
  const [confirmEvent, setConfirmEvent] = useState<ScheduleEvent | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const year = month.getFullYear()
  const monthNum = month.getMonth()
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  const visibleEvents = useMemo(
    () => (statusFilter ? events.filter((e) => e.status === statusFilter) : events),
    [events, statusFilter],
  )

  const cells = useMemo(() => {
    const firstDay = new Date(year, monthNum, 1)
    const daysInMonth = new Date(year, monthNum + 1, 0).getDate()
    const offset = firstDay.getDay()
    const blanks = Array.from({ length: offset }, () => null)
    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, monthNum, i + 1)
      return { key: toISODate(date), date, events: [] as ScheduleEvent[] }
    })
    return [...blanks, ...dayCells] as ({ key: string; date: Date; events: ScheduleEvent[] } | null)[]
  }, [year, monthNum])

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>()
    for (const ev of visibleEvents) {
      const k = localDateTimeKey(ev.starts_at)
      const list = map.get(k) ?? []
      list.push(ev)
      map.set(k, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return map
  }, [visibleEvents])

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
    setInitialDate(toISODate(date))
    setDialogOpen(true)
  }

  const openEdit = (ev: ScheduleEvent, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setDayView(null)
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

  const confirmDelete = async () => {
    if (!confirmEvent) return
    setDeleteBusy(true)
    try {
      await orgDeleteEvent(auth0Id, confirmEvent.id)
      setEvents((prev) => prev.filter((p) => p.id !== confirmEvent.id))
      toast.success("Event deleted")
      setDialogOpen(false)
      setConfirmEvent(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? "Failed to delete event")
    } finally {
      setDeleteBusy(false)
    }
  }

  const exportCSV = () => {
    downloadCSV(
      `schedule-${year}-${String(monthNum + 1).padStart(2, "0")}.csv`,
      [
        ["Date", "Start", "End", "Title", "Type", "Status", "Location", "Description"],
        ...visibleEvents
          .slice()
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map((e) => [
            localDateTimeKey(e.starts_at),
            e.starts_at.slice(11, 16),
            e.ends_at ? e.ends_at.slice(11, 16) : "",
            e.title,
            TYPE_META[e.event_type] ? EVENT_TYPE_LABELS[e.event_type] : e.event_type,
            EVENT_STATUS_LABELS[e.status] ?? e.status,
            e.location ?? "",
            e.description ?? "",
          ]),
      ],
    )
  }

  const todayKey = today.toDateString()
  const dayViewEvents = dayView ? byDay.get(toISODate(dayView)) ?? [] : []

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
        <p className="font-semibold text-lg text-foreground">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-muted-foreground" />}
        </p>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-input text-foreground border-input focus-visible:ring-ring/50 focus-visible:border-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <DownloadIcon /> Export
          </Button>
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
                onClick={() => setDayView(date)}
                className={`border-border group min-h-28 cursor-pointer border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/40 ${
                  isToday ? "bg-(--success)/5 border-(--success-border)" : ""
                }`}
              >
                <span
                  className={`mb-1 inline-flex size-5 items-center justify-center rounded text-xs ${
                    isToday ? "bg-(--success) font-bold text-background" : "text-muted-foreground"
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
                        className={`truncate rounded px-1.5 py-0.5 text-[0.6rem] leading-tight ${
                          ev.status === "cancelled" ? "line-through opacity-60" : ""
                        }`}
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

      {visibleEvents.length === 0 && (
        <p className="text-muted-foreground mt-4 text-xs">
          {events.length === 0
            ? `No events in ${monthLabel}. Click any day to add one.`
            : "No events match the selected status."}
        </p>
      )}

      {/* Day view */}
      <Dialog open={Boolean(dayView)} onOpenChange={(open) => !open && setDayView(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dayView?.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </DialogTitle>
            <DialogDescription>
              {dayViewEvents.length === 0
                ? "No events on this day."
                : `${dayViewEvents.length} event${dayViewEvents.length === 1 ? "" : "s"}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {dayViewEvents.map((ev) => {
              const meta = TYPE_META[ev.event_type] ?? TYPE_META.other
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEdit(ev)}
                  className="border-border hover:bg-accent/50 rounded-md border p-3 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground font-medium">{ev.title}</span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] ${
                        STATUS_META[ev.status]?.className ?? "border-border"
                      }`}
                    >
                      {EVENT_STATUS_LABELS[ev.status] ?? ev.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      {ev.starts_at.slice(11, 16)}
                      {ev.ends_at ? `–${ev.ends_at.slice(11, 16)}` : ""}
                    </span>
                    {ev.location && (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-3" /> {ev.location}
                      </span>
                    )}
                    <span style={{ color: meta.color }}>{EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}</span>
                  </div>
                </button>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDayView(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (dayView) {
                  setDayView(null)
                  openCreate(dayView)
                }
              }}
            >
              <PlusIcon /> Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(confirmEvent)} onOpenChange={(open) => !open && setConfirmEvent(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{confirmEvent?.title}”?</DialogTitle>
            <DialogDescription>This permanently removes the event. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEvent(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : "Delete event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventFormDialog
        key={editingEvent?.id ?? `new-${initialDate ?? "none"}`}
        auth0Id={auth0Id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editingEvent}
        initialDate={initialDate}
        onSaved={onSaved}
        onDelete={(ev) => setConfirmEvent(ev)}
      />
    </div>
  )
}