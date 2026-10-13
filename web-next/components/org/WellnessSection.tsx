'use client'

import { useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/9ui/ui/card'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import { orgCreateWellness, orgWellness, type WellnessCheckin } from '@/lib/org'
import { useOrgCrudList } from '@/lib/useOrgCrudList'

interface WellnessSectionProps {
  auth0Id: string
  studentId: string
}

const FATIGUE_LABELS = ['', 'Fresh', 'Good', 'Okay', 'Tired', 'Exhausted']

export default function WellnessSection({ auth0Id, studentId }: WellnessSectionProps) {
  const [denied, setDenied] = useState(false)
  const {
    items: checkins,
    isLoading,
    isBusy: busy,
    error,
    createItem,
  } = useOrgCrudList<
    WellnessCheckin,
    {
      sleep_hours: number | null
      fatigue: number | null
      availability: string | null
      note: string | null
    },
    never
  >({
    scopeKey: `${auth0Id}:${studentId}`,
    load: () => orgWellness(auth0Id, studentId).then((res) => res.checkins),
    create: (input) => orgCreateWellness(auth0Id, studentId, input).then((res) => res.checkin),
    onLoadError: (e) => {
      if (e instanceof Error && /403|FORBIDDEN/i.test(e.message)) setDenied(true)
    },
  })
  const [sleep, setSleep] = useState('')
  const [fatigue, setFatigue] = useState('')
  const [availability, setAvailability] = useState('')
  const [note, setNote] = useState('')

  const submit = async () => {
    const created = await createItem(
      {
        sleep_hours: sleep === '' ? null : Number(sleep),
        fatigue: fatigue === '' ? null : Number(fatigue),
        availability: availability.trim() || null,
        note: note.trim() || null,
      },
      'Could not record check-in.',
    )
    if (!created) return
    setSleep('')
    setFatigue('')
    setAvailability('')
    setNote('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wellness</CardTitle>
        <CardDescription>
          Health data — visible only to medical staff and the owner. Reported as observed, never
          diagnosed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {denied ? (
          <p className="text-sm text-muted-foreground">
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
                  className="h-9"
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
                  className="h-9"
                />
                {fatigue !== '' && (
                  <p className="text-[0.65rem] text-muted-foreground">
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button size="sm" disabled={busy} onClick={submit}>
              {busy ? 'Recording…' : 'Record check-in'}
            </Button>
            <div className="space-y-1.5 pt-1">
              {checkins.slice(0, 8).map((checkin) => (
                <div
                  key={checkin.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-xs"
                >
                  <span className="text-muted-foreground">
                    {new Date(checkin.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-foreground">
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
              {!isLoading && checkins.length === 0 && (
                <p className="text-xs text-muted-foreground">No check-ins yet.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
