'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import { orgCreateWellness, orgWellness, type WellnessCheckin } from '@/lib/org'
import Section from './Section'

interface WellnessSectionProps {
  auth0Id: string
  studentId: string
}

const FATIGUE_LABELS = ['', 'Fresh', 'Good', 'Okay', 'Tired', 'Exhausted']

export default function WellnessSection({ auth0Id, studentId }: WellnessSectionProps) {
  const [checkins, setCheckins] = useState<WellnessCheckin[] | null>(null)
  const [denied, setDenied] = useState(false)
  const [sleep, setSleep] = useState('')
  const [fatigue, setFatigue] = useState('')
  const [availability, setAvailability] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void orgWellness(auth0Id, studentId)
      .then((res) => {
        if (!cancelled) setCheckins(res.checkins)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof Error && /403|FORBIDDEN/i.test(e.message)) setDenied(true)
        else setCheckins([])
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await orgCreateWellness(auth0Id, studentId, {
        sleep_hours: sleep === '' ? null : Number(sleep),
        fatigue: fatigue === '' ? null : Number(fatigue),
        availability: availability.trim() || null,
        note: note.trim() || null,
      })
      setCheckins((prev) => [res.checkin, ...(prev ?? [])])
      setSleep('')
      setFatigue('')
      setAvailability('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record check-in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Wellness">
      <p className="mb-4 text-[13px] leading-[1.5] text-muted-foreground">
        Health data — visible only to medical staff and the owner. Reported as observed, never
        diagnosed.
      </p>
      <div className="space-y-3">
        {denied ? (
          <p className="text-[14px] text-muted-foreground">
            Reading wellness data requires the medical permission.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="well-sleep">Sleep (h)</Label>
                <Input
                  id="well-sleep"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={sleep}
                  onChange={(e) => setSleep(e.target.value)}
                  className="h-9 tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="well-fatigue">Fatigue (1–5)</Label>
                <Input
                  id="well-fatigue"
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={fatigue}
                  onChange={(e) => setFatigue(e.target.value)}
                  className="h-9 tabular-nums"
                />
                {fatigue !== '' && (
                  <p className="text-[13px] text-muted-foreground">
                    {FATIGUE_LABELS[Number(fatigue)] ?? ''}
                  </p>
                )}
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="well-avail">Availability</Label>
                <Input
                  id="well-avail"
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                  placeholder="available · limited · out"
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="well-note">Note</Label>
              <Textarea
                id="well-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Player-reported observation…"
              />
            </div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <Button size="sm" disabled={busy} onClick={submit}>
              {busy ? 'Recording…' : 'Record check-in'}
            </Button>
            <div className="pt-1">
              {(checkins ?? []).slice(0, 8).map((checkin) => (
                <div
                  key={checkin.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-[13px] last:border-b-0 hover:bg-accent/50 transition-colors"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(checkin.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-foreground tabular-nums">
                    {[
                      checkin.sleep_hours != null ? `${checkin.sleep_hours}h sleep` : null,
                      checkin.fatigue != null ? `fatigue ${checkin.fatigue}/5` : null,
                      checkin.availability,
                      checkin.pain ? `pain: ${checkin.pain}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') ||
                      checkin.note ||
                      '—'}
                  </span>
                </div>
              ))}
              {checkins?.length === 0 && (
                <p className="text-[13px] text-muted-foreground">No check-ins yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  )
}
