'use client'

import { useEffect, useMemo, useState } from 'react'

import Section from '@/components/org/Section'
import SettingRow from '@/components/org/SettingRow'
import { Spinner } from '@/components/org/Spinner'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { orgSettings, updateOrgSettings, type OrgSettings } from '@/lib/org'
import type { OrgMemberRole } from '@/lib/members'
import { errorMessageOf } from '@/lib/errors'

/**
 * A short, familiar zone list — enough to cover the clubs we actually see. The
 * server validates any IANA zone (and stores whatever it accepts), so a value
 * outside this list still round-trips and renders as its raw zone string.
 */
const TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'UTC', label: 'UTC · Coordinated Universal Time' },
  { value: 'America/Los_Angeles', label: 'Los Angeles · Pacific' },
  { value: 'America/Denver', label: 'Denver · Mountain' },
  { value: 'America/Chicago', label: 'Chicago · Central' },
  { value: 'America/New_York', label: 'New York · Eastern' },
  { value: 'America/Sao_Paulo', label: 'São Paulo · Brasília' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris · Central Europe' },
  { value: 'Africa/Lagos', label: 'Lagos · West Africa' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg · South Africa' },
  { value: 'Asia/Dubai', label: 'Dubai · Gulf' },
  { value: 'Asia/Kolkata', label: 'Kolkata · India' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
]

// The Select needs a non-empty item value, so "no zone" is a sentinel the
// component maps back to `null` on the wire.
const TIMEZONE_NONE = 'none'

const MAX_NAME_LENGTH = 120

/**
 * Organization settings — the org's own name and calendar timezone. Reads are
 * open to every org member; writes are owner/admin only, so the component
 * renders read-only values for everyone else instead of dead inputs.
 */
export default function OrganizationSettingsSection({
  auth0Id,
  role,
}: {
  /** The org's auth0 id — the settings live on the org, not on the caller. */
  auth0Id: string
  /** The caller's role in that org; owners and admins may edit. */
  role: OrgMemberRole | null
}) {
  const canEdit = role === 'owner' || role === 'admin'
  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void orgSettings(auth0Id)
      .then(({ settings: loaded }) => {
        if (!active) return
        setSettings(loaded)
        setNameDraft(loaded.name ?? '')
        setError(null)
      })
      .catch((cause) => {
        if (!active) return
        setError(errorMessageOf(cause, 'Failed to load organization settings.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [auth0Id])

  const timezoneItems = useMemo(() => {
    const items: Record<string, string> = { [TIMEZONE_NONE]: 'Not set' }
    for (const zone of TIMEZONES) items[zone.value] = zone.label
    // A zone stored through the API but absent from the short list still needs
    // a label, or the trigger would render a blank value.
    const stored = settings?.timezone
    if (stored && !items[stored]) items[stored] = stored
    return items
  }, [settings?.timezone])

  const trimmedName = nameDraft.trim()
  const isNameDirty = settings !== null && trimmedName !== (settings.name ?? '')

  // Optimistic write: the row paints the new value immediately and rolls back to
  // the server's value if the PATCH fails.
  const save = (patch: { name?: string; timezone?: string | null }) => {
    if (!settings || isSaving) return
    const previous = settings
    setSettings({
      ...settings,
      name: patch.name ?? settings.name,
      timezone: patch.timezone === undefined ? settings.timezone : patch.timezone,
    })
    setError(null)
    setIsSaving(true)

    void updateOrgSettings(auth0Id, patch)
      .then(({ settings: saved }) => {
        setSettings(saved)
        setNameDraft(saved.name ?? '')
      })
      .catch((cause) => {
        setSettings(previous)
        setNameDraft(previous.name ?? '')
        setError(errorMessageOf(cause, 'Failed to save organization settings.'))
      })
      .finally(() => setIsSaving(false))
  }

  const saveName = () => {
    if (!isNameDirty) return
    save({ name: trimmedName })
  }

  const selectTimezone = (next: string) => {
    if (!settings) return
    const value = next === TIMEZONE_NONE ? null : next
    if (value === settings.timezone) return
    save({ timezone: value })
  }

  return (
    <Section title="Organization">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : settings ? (
        <>
          <div>
            <SettingRow
              title="Organization name"
              description="How your club is named across the dashboard and organization switcher."
            >
              {canEdit ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveName()
                  }}
                >
                  <Input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={saveName}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Your club"
                    aria-label="Organization name"
                    className="w-52"
                    disabled={isSaving}
                  />
                  <Button type="submit" variant="outline" size="sm" disabled={!isNameDirty}>
                    Save
                  </Button>
                </form>
              ) : (
                <span className="text-body text-foreground">
                  {settings.name ? settings.name : 'Not set'}
                </span>
              )}
            </SettingRow>

            <SettingRow
              title="Timezone"
              description="Anchors schedules and reports to the club's own calendar."
            >
              {canEdit ? (
                <Select
                  items={timezoneItems}
                  value={settings.timezone ?? TIMEZONE_NONE}
                  onValueChange={(value) => {
                    if (typeof value === 'string' && value) selectTimezone(value)
                  }}
                >
                  <SelectTrigger className="w-64" aria-label="Timezone" disabled={isSaving}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TIMEZONE_NONE}>Not set</SelectItem>
                    {TIMEZONES.map((zone) => (
                      <SelectItem key={zone.value} value={zone.value}>
                        {zone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-body text-foreground">{settings.timezone ?? 'Not set'}</span>
              )}
            </SettingRow>
          </div>

          {isSaving ? (
            <div
              className="mt-4 flex items-center gap-2 text-meta text-muted-foreground"
              role="status"
            >
              <Spinner />
              Saving organization settings…
            </div>
          ) : null}
          {canEdit ? null : (
            <p className="mt-4 text-meta text-muted-foreground">
              Only the owner and admins can change these settings.
            </p>
          )}
        </>
      ) : null}
      {/* Rendered OUTSIDE the `settings ?` branch on purpose. A failed READ leaves
          `settings` null, so an error paragraph nested in that branch is unreachable
          in exactly the case it exists for: the heading painted and then nothing at
          all — no spinner, no message, no fields. A rejected fetch is a loading
          problem, not an empty organization, and it has to be legible as one. */}
      {error ? (
        <p
          className="mt-4 rounded-[6px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-body text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Section>
  )
}
