'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import { Spinner } from './Spinner'

import type { ScheduleEvent } from '@/lib/org'
import { orgCreateEvent, orgUpdateEvent, EVENT_STATUSES, EVENT_TYPES } from '@/lib/org'
import { toISODate, toISOTime } from '@/lib/date'
import type { CoachAIError } from '@/types'

export type EventFormValues = {
  title: string
  event_type: string
  date: string
  start_time: string
  end_time: string
  location: string
  description: string
  status: string
}

function toFormValues(event?: ScheduleEvent | null, initialDate?: string): EventFormValues {
  if (event) {
    const start = new Date(event.starts_at)
    const date = toISODate(start)
    const start_time = toISOTime(start)
    let end_time = ''
    if (event.ends_at) {
      const end = new Date(event.ends_at)
      if (!Number.isNaN(end.getTime())) end_time = toISOTime(end)
    }
    return {
      title: event.title,
      event_type: event.event_type,
      date,
      start_time,
      end_time,
      location: event.location ?? '',
      description: event.description ?? '',
      status: event.status,
    }
  }
  return {
    title: '',
    event_type: 'practice',
    date: initialDate ?? '',
    start_time: '17:00',
    end_time: '',
    location: '',
    description: '',
    status: 'scheduled',
  }
}

export default function EventFormDialog({
  auth0Id,
  open,
  onOpenChange,
  event,
  initialDate,
  onSaved,
  onDelete,
}: {
  auth0Id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  event?: ScheduleEvent | null
  initialDate?: string
  onSaved: (event: ScheduleEvent) => void
  onDelete?: (event: ScheduleEvent) => void
}) {
  const editing = Boolean(event)
  const [values, setValues] = useState<EventFormValues>(() => toFormValues(event, initialDate))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the form from the target event/date whenever the dialog is (re)opened.
  // Render-time state adjustment is the documented alternative to setState-in-effect.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setValues(toFormValues(event, initialDate))
  }

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const submit = async () => {
    if (!values.title.trim()) {
      setError('Title is required')
      return
    }
    if (!values.date || !values.start_time) {
      setError('Pick a date and start time')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const starts_at = `${values.date}T${values.start_time}:00`
      const ends_at = values.end_time ? `${values.date}T${values.end_time}:00` : null
      if (editing && event) {
        const res = await orgUpdateEvent(auth0Id, event.id, {
          title: values.title,
          event_type: values.event_type as ScheduleEvent['event_type'],
          starts_at,
          ends_at,
          location: values.location || null,
          description: values.description || null,
          status: values.status as ScheduleEvent['status'],
        })
        toast.success('Event updated')
        onSaved(res.event)
      } else {
        const res = await orgCreateEvent(auth0Id, {
          title: values.title,
          event_type: values.event_type as ScheduleEvent['event_type'],
          starts_at,
          ends_at,
          location: values.location || null,
          description: values.description || null,
          status: values.status as ScheduleEvent['status'],
        })
        toast.success('Event added')
        onSaved(res.event)
      }
      onOpenChange(false)
    } catch (err) {
      setError((err as CoachAIError).message ?? 'Failed to save event')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Event' : 'Add Event'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. U-14 Tennis Practice"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="event_type">Type</Label>
              <NativeSelect
                id="event_type"
                value={values.event_type}
                onChange={(v) => set('event_type', v)}
                options={[...EVENT_TYPES]}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="status">Status</Label>
              <NativeSelect
                id="status"
                value={values.status}
                onChange={(v) => set('status', v)}
                options={[...EVENT_STATUSES]}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={values.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="start_time">Starts *</Label>
              <Input
                id="start_time"
                type="time"
                value={values.start_time}
                onChange={(e) => set('start_time', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end_time">Ends</Label>
              <Input
                id="end_time"
                type="time"
                value={values.end_time}
                onChange={(e) => set('end_time', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={values.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="e.g. Court 2, Riverside Club"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
            />
          </div>

          {error && <p className="text-meta text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <div className="flex w-full flex-row items-center justify-between">
            {editing && event && onDelete ? (
              <Button variant="destructive" onClick={() => onDelete(event)}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? <Spinner /> : editing ? 'Save changes' : 'Add event'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  placeholder?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--input-fill)] text-foreground focus-visible:ring-ring/40 border-input focus-visible:border-ring h-9 w-full rounded-[6px] border px-3 py-1.5 text-body outline-none focus-visible:ring-2"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}
