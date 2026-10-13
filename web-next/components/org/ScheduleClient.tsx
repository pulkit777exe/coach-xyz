'use client'

import { useMemo, useState } from 'react'
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
import { downloadCSV } from '@/lib/csv'

import type { EventStatus, ScheduleEvent } from '@/lib/org'
import {
  orgSchedule,
  orgDeleteEvent,
  EVENT_STATUSES,
  EVENT_TYPE_LABELS,
  EVENT_STATUS_LABELS,
} from '@/lib/org'
import { toISODate, scheduleMonthWindow } from '@/lib/date'
import { useMonthNavigator } from '@/lib/useMonthNavigator'
import { usePreferences } from '@/lib/preferences'
import type { CoachAIError } from '@/types'

const TYPE_META: Record<
  ScheduleEvent['event_type'],
  { color: string; bg: string; border: string }
> = {
  practice: {
    color: 'var(--info)',
    bg: 'color-mix(in srgb, var(--info) 12%, transparent)',
    border: 'var(--info-border)',
  },
  match: {
    color: 'var(--destructive)',
    bg: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
    border: 'var(--danger-border)',
  },
  tournament: {
    color: 'var(--warning)',
    bg: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    border: 'var(--warning-border)',
  },
  meeting: {
    color: 'var(--success)',
    bg: 'color-mix(in srgb, var(--success) 12%, transparent)',
    border: 'var(--success-border)',
  },
  other: {
    color: 'var(--muted-foreground)',
    bg: 'color-mix(in srgb, var(--muted) 60%, transparent)',
    border: 'var(--border)',
  },
}

const STATUS_META: Record<EventStatus, { className: string }> = {
  scheduled: { className: 'border-info-border text-info' },
  completed: { className: 'border-success-border text-success' },
  cancelled: { className: 'border-danger-border text-danger' },
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
}: {
  auth0Id: string
  initialEvents: ScheduleEvent[]
}) {
  const today = new Date()
  const {
    year,
    monthNum,
    monthLabel,
    isLoading: loading,
    setMonth,
    fetchMonth,
    nav,
  } = useMonthNavigator({
    onFetch: async (target) => {
      // Widen by one day on each side so midnight (local) month-boundary
      // events survive the UTC-truncated filter. byDay only places events on
      // matching local-day cells, so out-of-month buffer rows are dropped.
      const { from, to } = scheduleMonthWindow(target)
      const res = await orgSchedule(auth0Id, { from: from.toISOString(), to: to.toISOString() })
      setEvents(res.events)
    },
    onError: (err) => toast.error((err as CoachAIError).message ?? 'Failed to load schedule'),
  })
  const { prefs } = usePreferences()
  const weekStartsMonday = prefs.weekStartsMonday
  const [events, setEvents] = useState<ScheduleEvent[]>(initialEvents)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null)
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState('')
  const [dayView, setDayView] = useState<Date | null>(null)
  const [confirmEvent, setConfirmEvent] = useState<ScheduleEvent | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

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
        <p className="font-semibold text-lg text-foreground">
          {monthLabel}
          {loading && <Spinner className="ml-3 inline text-muted-foreground" />}
        </p>
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
          {orderedWeekdays(weekStartsMonday).map((w) => (
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
                className={`border-border group min-h-28 cursor-pointer border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  isToday ? 'bg-success/5 border-success-border' : ''
                }`}
              >
                <span
                  className={`mb-1 inline-flex size-5 items-center justify-center rounded text-xs ${
                    isToday
                      ? 'bg-success font-bold text-primary-foreground'
                      : 'text-muted-foreground'
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
                          ev.status === 'cancelled' ? 'line-through opacity-60' : ''
                        }`}
                        style={{
                          color: meta.color,
                          background: meta.bg,
                          border: `1px solid ${meta.border}`,
                        }}
                      >
                        <span className="font-semibold">{ev.starts_at.slice(11, 16)}</span>{' '}
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
                        STATUS_META[ev.status]?.className ?? 'border-border'
                      }`}
                    >
                      {EVENT_STATUS_LABELS[ev.status] ?? ev.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      {ev.starts_at.slice(11, 16)}
                      {ev.ends_at ? `–${ev.ends_at.slice(11, 16)}` : ''}
                    </span>
                    {ev.location && (
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="size-3" /> {ev.location}
                      </span>
                    )}
                    <span style={{ color: meta.color }}>
                      {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                    </span>
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
    </div>
  )
}
