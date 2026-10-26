'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import { orgCreateWellness, orgWellness } from '@/lib/org/wellness'
import { type WellnessCheckin } from '@/lib/org/types'
import Section from './Section'
import { formatDateNumeric } from '@/lib/date'

interface WellnessSectionProps {
  auth0Id: string
  studentId: string
  /** Check-in writes — player.manage (reads stay medical-gated server-side). */
  canWrite: boolean
}

const FATIGUE_LABELS = ['', 'Fresh', 'Good', 'Okay', 'Tired', 'Exhausted']

export default function WellnessSection({ auth0Id, studentId, canWrite }: WellnessSectionProps) {
  const [checkins, setCheckins] = useState<WellnessCheckin[] | null>(null)
  // Records WHICH player's check-ins have settled and whether that read failed, so the
  // three answers stay apart: still loading, could not be read, genuinely none. Keying
  // on `studentId` also stops the previous player's rows — or their failure — being
  // shown against the newly selected player while the new read is in flight.
  const [checkinsOutcome, setCheckinsOutcome] = useState<{
    studentId: string
    failed: boolean
  } | null>(null)
  const [denied, setDenied] = useState(false)
  const [sleep, setSleep] = useState('')
  const [fatigue, setFatigue] = useState('')
  const [availability, setAvailability] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Recorded in the closure rather than in state, so it can ride out with the single
    // settle below. Every failure used to end in `setCheckins([])`, which is the whole
    // defect: a coach or medical staffer reading a 500 saw "No check-ins yet." for a
    // player with a season of recorded wellness data, and because the list renders from
    // `(checkins ?? [])` there was no loading state either — just a blank gap.
    let failed = false
    void orgWellness(auth0Id, studentId)
      .then((res) => {
        if (!cancelled) setCheckins(res.checkins)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof Error && /403|FORBIDDEN/i.test(e.message)) {
          // A 403 is a real answer, not a failed read: this caller is not permitted to
          // see the data. It renders as its own sentence and must not also light the
          // failure flag, which would say the read broke rather than that it was refused.
          setDenied(true)
          return
        }
        failed = true
        setCheckins([])
      })
      .finally(() => {
        if (!cancelled) setCheckinsOutcome({ studentId, failed })
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  // Derived, not stored: the list is loading until it has settled for THIS player, which
  // covers the first mount and every student switch.
  const checkinsLoading = checkinsOutcome?.studentId !== studentId
  const checkinsFailed = !checkinsLoading && (checkinsOutcome?.failed ?? false)

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
      <p className="mb-4 text-meta leading-[1.5] text-muted-foreground">
        Health data — visible only to medical staff and the owner. Reported as observed, never
        diagnosed.
      </p>
      <div className="space-y-3">
        {denied ? (
          <p className="text-body text-muted-foreground">
            Reading wellness data requires the medical permission.
          </p>
        ) : (
          <>
            {canWrite && (
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
                      <p className="text-meta text-muted-foreground">
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
                {error && <p className="text-meta text-destructive">{error}</p>}
                <Button size="sm" disabled={busy} onClick={submit}>
                  {busy ? 'Recording…' : 'Record check-in'}
                </Button>
              </>
            )}
            <div className="pt-1">
              {checkinsLoading ? (
                <p className="text-meta text-muted-foreground">Loading check-ins…</p>
              ) : checkinsFailed ? (
                // "No check-ins yet." here would be a lie in the dangerous direction: it
                // tells a coach there is no health history for this player when the truth
                // is that the history could not be read. Distinct copy, because the
                // reader's next action differs — reload the page, not "record more".
                <p className="text-meta text-muted-foreground">
                  Check-ins failed to load. This is a loading problem, not an empty history —
                  reload the page.
                </p>
              ) : (
                <>
                  {(checkins ?? []).slice(0, 8).map((checkin) => (
                    <div
                      key={checkin.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-meta last:border-b-0 hover:bg-accent/50 transition-colors"
                    >
                      <span className="text-muted-foreground tabular-nums">
                        {formatDateNumeric(checkin.created_at)}
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
                    <p className="text-meta text-muted-foreground">No check-ins yet.</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  )
}
