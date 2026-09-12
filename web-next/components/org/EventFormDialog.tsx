"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/9ui/ui/dialog"
import { Button } from "@/components/9ui/ui/button"
import { Input } from "@/components/9ui/ui/input"
import { Label } from "@/components/9ui/ui/label"
import { Textarea } from "@/components/9ui/ui/textarea"
import { Spinner } from "./Spinner"

import type { ScheduleEvent } from "@/lib/org"
import { orgCreateEvent, orgUpdateEvent } from "@/lib/org"
import type { CoachAIError } from "@/lib/api"

const EVENT_TYPES = ["practice", "match", "tournament", "meeting", "other"] as const
const EVENT_STATUSES = ["scheduled", "completed", "cancelled"] as const

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
    const pad = (n: number) => String(n).padStart(2, "0")
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
    const start_time = `${pad(start.getHours())}:${pad(start.getMinutes())}`
    let end_time = ""
    if (event.ends_at) {
      const end = new Date(event.ends_at)
      if (!Number.isNaN(end.getTime())) end_time = `${pad(end.getHours())}:${pad(end.getMinutes())}`
    }
    return {
      title: event.title,
      event_type: event.event_type,
      date,
      start_time,
      end_time,
      location: event.location ?? "",
      description: event.description ?? "",
      status: event.status,
    }
  }
  return {
    title: "",
    event_type: "practice",
    date: initialDate ?? "",
    start_time: "17:00",
    end_time: "",
    location: "",
    description: "",
    status: "scheduled",
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

  useEffect(() => {
    if (open) setValues(toFormValues(event, initialDate))
  }, [open, event, initialDate])

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const submit = async () => {
    if (!values.title.trim()) {
      setError("Title is required")
      return
    }
    if (!values.date || !values.start_time) {
      setError("Pick a date and start time")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const starts_at = `${values.date}T${values.start_time}:00`
      const ends_at = values.end_time ? `${values.date}T${values.end_time}:00` : undefined
      if (editing && event) {
        const res = await orgUpdateEvent(auth0Id, event.id, {
          title: values.title,
          event_type: values.event_type as ScheduleEvent["event_type"],
          starts_at,
          ends_at,
          location: values.location || undefined,
          description: values.description || undefined,
          status: values.status as ScheduleEvent["status"],
        })
        toast.success("Event updated")
        onSaved(res.event)
      } else {
        const res = await orgCreateEvent(auth0Id, {
          title: values.title,
          event_type: values.event_type as ScheduleEvent["event_type"],
          starts_at,
          ends_at,
          location: values.location || undefined,
          description: values.description || undefined,
          status: values.status as ScheduleEvent["status"],
        })
        toast.success("Event added")
        onSaved(res.event)
      }
      onOpenChange(false)
    } catch (err) {
      setError((err as CoachAIError).message ?? "Failed to save event")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Event" : "Add Event"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. U-14 Tennis Practice"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="event_type">Type</Label>
              <NativeSelect
                id="event_type"
                value={values.event_type}
                onChange={(v) => set("event_type", v)}
                options={[...EVENT_TYPES]}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <NativeSelect
                id="status"
                value={values.status}
                onChange={(v) => set("status", v)}
                options={[...EVENT_STATUSES]}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={values.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="start_time">Starts *</Label>
              <Input
                id="start_time"
                type="time"
                value={values.start_time}
                onChange={(e) => set("start_time", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="end_time">Ends</Label>
              <Input
                id="end_time"
                type="time"
                value={values.end_time}
                onChange={(e) => set("end_time", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={values.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="e.g. Court 2, Riverside Club"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-(--danger)">{error}</p>}
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
                {submitting ? <Spinner /> : editing ? "Save changes" : "Add event"}
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
      className="bg-input text-foreground focus-visible:ring-ring/50 border-input focus-visible:border-ring h-9 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
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