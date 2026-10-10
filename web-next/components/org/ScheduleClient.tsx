'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ClockIcon,
  MapPinIcon,
} from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Spinner } from './Spinner'
import EventFormDialog from './EventFormDialog'
import StatusPill from './StatusPill'
import { downloadCSV } from '@/lib/csv'
import { cn } from '@/lib/utils'

import type { EventStatus, ScheduleEvent } from '@/lib/org'
import {
  orgSchedule,
  orgDeleteEvent,
  EVENT_STATUSES,
  EVENT_TYPE_LABELS,
  EVENT_STATUS_LABELS,
} from '@/lib/org'
import { toISODate, scheduleMonthWindow } from '@/lib/date'
import { usePreferences } from '@/lib/preferences'
import type { CoachAIError } from '@/lib/api'

const TYPE_META: Record<ScheduleEvent['event_type'], { text: string; bg: string; border: string }> =
  {
    practice: { text: 'text-info', bg: 'bg-info/10', border: 'border-info-border' },
    match: {
      text: 'text-destructive',
      bg: 'bg-destructive/10',
      border: 'border-destructive-border',
    },
    tournament: { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning-border' },
    meeting: { text: 'text-success', bg: 'bg-success/10', border: 'border-success-border' },
    other: { text: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border' },
  }

const STATUS_TONE: Record<EventStatus, 'blue' | 'green' | 'red'> = {
  scheduled: 'blue',
  completed: 'green',
  cancelled: 'red',
}

function localDateTimeKey(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return toISODate(d)
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Rotate weekday labels + calendar offset so weeks can start on Monday. */
export function orderedWeekdays(mondayFirst: boolean): string[] {
  return mondayFirst ? [...WEEKDAY_LABELS.slice(1), WEEKDAY_LABELS[0]] : WEEKDAY_LABELS
}

export function weekStartOffset(date: Date, mondayFirst: boolean): number {
  const day = date.getDay()
  return mondayFirst ? (day + 6) % 7 : day
}

export default function ScheduleClient({
  auth0Id,
  initialEvents,
  canWrite = true,
}: {
  auth0Id: string
  initialEvents: ScheduleEvent[]
  /** attendance.write — false renders the calendar read-only (analyst/medical). */
  canWrite?: boolean
}) {
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const { prefs } = usePreferences()
  const weekStartsMonday = prefs.weekStartsMonday
  const [events, setEvents] = useState<ScheduleEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)
  /**
   * Identity of the newest month read. `nav` and the "jump to today" control both fire
   * `fetchMonth` without disabling the pager, so two month reads can be in flight at once
   * over DIFFERENT months — and neither response says which month it belongs to. Without
   * this, whichever landed LAST won, so an abandoned month's rows replaced the month the
   * heading names. Only the newest read may answer.
   */
  const monthSeq = useRef(0)
  /**
   * Which month `events` ACTUALLY holds, not which month is displayed.
   *
   * `nav` calls `setMonth(next)` before the fetch, so a failed navigation kept the previous
   * month's events under the new month's heading — and `exportCSV` names the file from the
   * DISPLAYED month while writing the rows from `events`, producing `schedule-2026-11.csv`
   * containing October's fixtures. Same defect as `AttendanceGrid`, same fix, same reason for
   * keying on the month instead of holding a boolean: a bare flag cannot say which read it
   * belongs to and survives the very navigation that made it wrong.
   */
  const [eventsMonth, setEventsMonth] = useState<string | null>(toISODate(month))
  const [monthFailed, setMonthFailed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null)
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState('')
  const [dayView, setDayView] = useState<Date | null>(null)
  const [confirmEvent, setConfirmEvent] = useState<ScheduleEvent | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const year = month.getFullYear()
  const monthNum = month.getMonth()
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const displayedMonth = toISODate(new Date(year, monthNum, 1))
  const eventsAreStale = eventsMonth !== null && eventsMonth !== displayedMonth
  const canExport = eventsMonth === displayedMonth && !loading

  const visibleEvents = useMemo(
    () => (statusFilter ? events.filter((e) => e.status === statusFilter) : events),
    [events, statusFilter],
  )

  const cells = useMemo(() => {
    const firstDay = new Date(year, monthNum, 1)
    const daysInMonth = new Date(year, monthNum + 1, 0).getDate()
    const offset = weekStartOffset(firstDay, weekStartsMonday)
    const blanks = Array.from({ length: offset }, () => null)
    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, monthNum, i + 1)
      return { key: toISODate(date), date, events: [] as ScheduleEvent[] }
    })
    return [...blanks, ...dayCells] as ({
      key: string
      date: Date
      events: ScheduleEvent[]
    } | null)[]
  }, [year, monthNum, weekStartsMonday])

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
    const my = ++monthSeq.current
    setLoading(true)
    try {
      // Widen by one day on each side so midnight (local) month-boundary
      // events survive the UTC-truncated filter. byDay only places events on
      // matching local-day cells, so out-of-month buffer rows are dropped.
      const { from, to } = scheduleMonthWindow(target)
      const res = await orgSchedule(auth0Id, { from: from.toISOString(), to: to.toISOString() })
      if (monthSeq.current !== my) return
      setEvents(res.events)
      setEventsMonth(toISODate(target))
      setMonthFailed(false)
    } catch (err) {
      if (monthSeq.current !== my) return
      // `eventsMonth` deliberately NOT advanced: that is what keeps the mismatch detectable.
      setMonthFailed(true)
      toast.error((err as CoachAIError).message ?? 'Failed to load schedule')
    } finally {
      // A superseded read must not drop the spinner while the read actually being
      // displayed is still in flight.
      if (monthSeq.current === my) setLoading(false)
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
      toast.success('Event deleted')
      setDialogOpen(false)
      setConfirmEvent(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to delete event')
    } finally {
      setDeleteBusy(false)
    }
  }

  const exportCSV = () => {
    // Refuse rather than write a file whose contents contradict its name: the name comes from
    // the DISPLAYED month and the rows from `events`, which after a failed navigation belong
    // to the previous one.
    if (!canExport) return
    downloadCSV(`schedule-${year}-${String(monthNum + 1).padStart(2, '0')}.csv`, [
      ['Date', 'Start', 'End', 'Title', 'Type', 'Status', 'Location', 'Description'],
      ...visibleEvents
        .slice()
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((e) => [
          localDateTimeKey(e.starts_at),
          e.starts_at.slice(11, 16),
          e.ends_at ? e.ends_at.slice(11, 16) : '',
          e.title,
          TYPE_META[e.event_type] ? EVENT_TYPE_LABELS[e.event_type] : e.event_type,
          EVENT_STATUS_LABELS[e.status] ?? e.status,
          e.location ?? '',
          e.description ?? '',
        ]),
    ])
  }

  const todayKey = today.toDateString()
  const dayViewEvents = dayView ? (byDay.get(toISODate(dayView)) ?? []) : []

  return (
    <div>
      {!canWrite && (
        <p className="text-muted-foreground mb-3 text-meta">
          You have read-only access to this page.
        </p>
      )}
      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
              const now = new Date()
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
              fetchMonth(new Date(now.getFullYear(), now.getMonth(), 1))
            }}
          >
            Today
          </Button>
        </div>
        {/* A `div`, not a `p`: `loading-dev`'s `Slide` renders a `<div>`, and a `<div>`
            inside a `<p>` is invalid nesting React warns will cause a hydration error. */}
        <div className="text-lead font-semibold tracking-[-0.01em] text-foreground">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter || 'all'}
            onValueChange={(v) => setStatusFilter(v === 'all' ? '' : (v as string))}
          >
            <SelectTrigger size="sm" aria-label="Filter by status" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EVENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {EVENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={!canExport}
            title={
              canExport
                ? undefined
                : 'Cannot export while the displayed month has not loaded — the file would be named for one month and contain another.'
            }
          >
            <DownloadIcon /> Export
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => openCreate(new Date())}>
              <PlusIcon /> Add event
            </Button>
          )}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border-border overflow-hidden rounded-[6px] border">
        <div className="grid grid-cols-7 border-b border-border">
          {orderedWeekdays(weekStartsMonday).map((w) => (
            <div
              key={w}
              className="py-2 text-center text-label font-medium uppercase tracking-[0.08em] text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            if (!cell)
              return (
                <div
                  key={`blank-${idx}`}
                  className="border-border bg-background/40 min-h-28 border-b border-r p-1.5"
                />
              )
            const { date, key } = cell
            const dayEvents = byDay.get(key) ?? []
            const isToday = date.toDateString() === todayKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDayView(date)}
                className={`border-border group min-h-28 cursor-pointer border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                  isToday ? 'bg-accent/40' : ''
                }`}
              >
                <span
                  className={cn(
                    'mb-1 inline-flex size-5 items-center justify-center rounded-[4px] text-caption tabular-nums',
                    isToday ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {date.getDate()}
                </span>
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => {
                    const meta = TYPE_META[ev.event_type] ?? TYPE_META.other
                    return (
                      <div
                        key={ev.id}
                        onClick={canWrite ? (e) => openEdit(ev, e) : undefined}
                        title={ev.title}
                        className={cn(
                          'truncate rounded-[4px] border px-1.5 py-0.5 text-label font-medium leading-tight transition-colors',
                          meta.text,
                          meta.bg,
                          meta.border,
                          ev.status === 'cancelled' ? 'line-through opacity-60' : '',
                        )}
                      >
                        <span className="tabular-nums">{ev.starts_at.slice(11, 16)}</span>{' '}
                        {ev.title}
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <span className="text-muted-foreground block px-1 text-label tabular-nums">
                      +{dayEvents.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/*
        The stale-rows banner. After a failed navigation `events` holds the PREVIOUS month, so
        the grid and the empty-state copy below both describe a month they are not showing —
        and the CSV export, which names the file from the DISPLAYED month, would have written
        October's fixtures into `schedule-2026-11.csv`. The toast had already gone.
      */}
      {eventsAreStale && (
        <p
          role="status"
          className="mt-4 rounded-[6px] border border-border bg-muted px-3 py-2 text-meta text-muted-foreground"
        >
          {monthFailed
            ? `${monthLabel} failed to load, so the events below are from a different month.`
            : `Loading ${monthLabel}…`}
        </p>
      )}

      {!eventsAreStale && visibleEvents.length === 0 && (
        <p className="text-muted-foreground mt-4 text-meta">
          {events.length === 0
            ? canWrite
              ? `No events in ${monthLabel}. Click any day to add one.`
              : `No events in ${monthLabel}.`
            : 'No events match the selected status.'}
        </p>
      )}

      {/* Day view */}
      <Dialog open={Boolean(dayView)} onOpenChange={(open) => !open && setDayView(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dayView?.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </DialogTitle>
            <DialogDescription>
              {dayViewEvents.length === 0
                ? 'No events on this day.'
                : `${dayViewEvents.length} event${dayViewEvents.length === 1 ? '' : 's'}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {dayViewEvents.map((ev) => {
              const eventCard = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body font-medium text-foreground">{ev.title}</span>
                    <StatusPill tone={STATUS_TONE[ev.status]}>
                      {EVENT_STATUS_LABELS[ev.status] ?? ev.status}
                    </StatusPill>
                  </div>
                  <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-meta">
                    <span className="flex items-center gap-1 tabular-nums">
                      <ClockIcon className="size-3" />
                      {ev.starts_at.slice(11, 16)}
                      {ev.ends_at ? `–${ev.ends_at.slice(11, 16)}` : ''}
                    </span>
                    {ev.location && (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-3" /> {ev.location}
                      </span>
                    )}
                    <span className={cn(TYPE_META[ev.event_type]?.text ?? TYPE_META.other.text)}>
                      {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                    </span>
                  </div>
                </>
              )
              if (!canWrite) {
                return (
                  <div
                    key={ev.id}
                    className="border-border rounded-[6px] border p-3 text-left transition-colors"
                  >
                    {eventCard}
                  </div>
                )
              }
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEdit(ev)}
                  className="border-border hover:bg-accent/50 rounded-[6px] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {eventCard}
                </button>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDayView(null)}>
              Close
            </Button>
            {canWrite && (
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
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(confirmEvent)} onOpenChange={(open) => !open && setConfirmEvent(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{confirmEvent?.title}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the event. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEvent(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : 'Delete event'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/edit form — also carries the delete affordance, so it never mounts read-only */}
      {canWrite && (
        <EventFormDialog
          key={editingEvent?.id ?? `new-${initialDate ?? 'none'}`}
          auth0Id={auth0Id}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          event={editingEvent}
          initialDate={initialDate}
          onSaved={onSaved}
          onDelete={(ev) => setConfirmEvent(ev)}
        />
      )}
    </div>
  )
}
