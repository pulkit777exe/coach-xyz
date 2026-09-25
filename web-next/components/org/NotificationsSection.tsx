'use client'

import { useEffect, useState } from 'react'

import Section from '@/components/org/Section'
import SettingRow from '@/components/org/SettingRow'
import { Spinner } from '@/components/org/Spinner'
import { Switch } from '@/components/9ui/ui/switch'
import {
  getNotificationPrefs,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  type NotificationEvent,
  type NotificationEvents,
  type NotificationPrefs,
  updateNotificationPrefs,
} from '@/lib/meApi'

const DEFAULT_EVENTS: NotificationEvents = {
  analysis_complete: true,
  analysis_failed: true,
  report_ready: true,
  attendance: true,
  ai_report: true,
  membership: true,
}

const DEFAULT_PREFS: NotificationPrefs = {
  inApp: true,
  cadence: 'instant',
  events: DEFAULT_EVENTS,
  updatedAt: null,
}

const EVENT_DESCRIPTIONS: Record<NotificationEvent, string> = {
  analysis_complete: 'When a video finishes processing, so you can review the result.',
  analysis_failed: 'When a video cannot finish, so you can retry or investigate.',
  report_ready: 'When a report is ready to view and share.',
  attendance: 'When attendance is recorded, so your training history stays current.',
  ai_report: 'When an AI report finishes generating, so you can read the insights.',
  membership: 'When your team access or membership changes, so you can act on it.',
}

const EVENT_ROWS = NOTIFICATION_EVENTS.map((event) => ({
  event,
  label: NOTIFICATION_EVENT_LABELS[event],
  description: EVENT_DESCRIPTIONS[event],
}))

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export default function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void getNotificationPrefs()
      .then((next) => {
        if (!active) return
        setPrefs(next)
        setError(null)
      })
      .catch((cause) => {
        if (!active) return
        // A missing row is already the server's enabled default. Keeping the
        // same local default also lets a user retry after a transient GET error.
        setPrefs(DEFAULT_PREFS)
        setError(errorMessage(cause, 'Failed to load notification preferences.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const updateMaster = (inApp: boolean) => {
    if (!prefs || isSaving) return
    const previous = prefs
    setPrefs({ ...prefs, inApp })
    setError(null)
    setIsSaving(true)

    void updateNotificationPrefs({ inApp })
      .then((saved) => setPrefs(saved))
      .catch((cause) => {
        setPrefs(previous)
        setError(errorMessage(cause, 'Failed to save notification preferences.'))
      })
      .finally(() => setIsSaving(false))
  }

  const updateEvent = (event: NotificationEvent, enabled: boolean) => {
    if (!prefs || isSaving) return
    const previous = prefs
    setPrefs({
      ...prefs,
      events: { ...prefs.events, [event]: enabled },
    })
    setError(null)
    setIsSaving(true)

    void updateNotificationPrefs({ events: { [event]: enabled } })
      .then((saved) => setPrefs(saved))
      .catch((cause) => {
        setPrefs(previous)
        setError(errorMessage(cause, 'Failed to save notification preferences.'))
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <Section title="Notifications">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : prefs ? (
        <>
          <div>
            <SettingRow
              title="In-app notifications"
              description="Show alerts when your work finishes or something changes."
            >
              <Switch
                checked={prefs.inApp}
                onCheckedChange={updateMaster}
                disabled={isSaving}
                aria-label="In-app notifications"
              />
            </SettingRow>
          </div>

          <p className="mb-1 mt-6 text-meta font-medium leading-[1.4] text-foreground">Events</p>
          <div className={prefs.inApp ? undefined : 'opacity-60'}>
            {EVENT_ROWS.map(({ event, label, description }) => (
              <SettingRow key={event} title={label} description={description}>
                <Switch
                  checked={prefs.events[event]}
                  onCheckedChange={(enabled) => updateEvent(event, enabled)}
                  disabled={isSaving || !prefs.inApp}
                  aria-label={label}
                />
              </SettingRow>
            ))}
          </div>

          {/* The server already stores cadence for the upcoming digest worker. */}
          {isSaving ? (
            <div
              className="mt-4 flex items-center gap-2 text-meta text-muted-foreground"
              role="status"
            >
              <Spinner />
              Saving notification preferences…
            </div>
          ) : null}
          {error ? (
            <p
              className="mt-4 rounded-[6px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-body text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </Section>
  )
}
