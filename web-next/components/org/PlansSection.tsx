'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/9ui/ui/dialog'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import Section from './Section'
import StatusPill, { type StatusTone } from './StatusPill'
import { orgCreatePlan, orgDeletePlan, orgPlans, orgSetPlanStatus } from '@/lib/org/plans'
import { type TrainingPlan } from '@/lib/org/plans'

interface PlansSectionProps {
  auth0Id: string
  studentId: string
  /** Plan writes (create/status/delete) — player.manage, enforced server-side. */
  canWrite: boolean
}

const PLAN_TONE: Record<TrainingPlan['status'], StatusTone> = {
  active: 'blue',
  done: 'green',
  archived: 'gray',
}

export default function PlansSection({ auth0Id, studentId, canWrite }: PlansSectionProps) {
  const [plans, setPlans] = useState<TrainingPlan[]>([])
  // Records WHICH player's plans have settled and whether that read failed. `plans`
  // itself starts as `[]`, so without this every visit flashed "No training plans yet."
  // before the read resolved, and a permanent failure left that sentence there. Keying
  // on `studentId` also stops the previous player's plans being shown against the newly
  // selected player while the new read is in flight.
  const [plansOutcome, setPlansOutcome] = useState<{ studentId: string; failed: boolean } | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The list still resets to `[]` on failure so the `.map` below stays total, but the
    // failure is now recorded rather than being the only thing the render can see.
    let failed = false
    void orgPlans(auth0Id, { studentId })
      .then((res) => {
        if (!cancelled) setPlans(res.plans)
      })
      .catch(() => {
        failed = true
        if (!cancelled) setPlans([])
      })
      .finally(() => {
        if (!cancelled) setPlansOutcome({ studentId, failed })
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  const plansLoading = plansOutcome?.studentId !== studentId
  const plansFailed = !plansLoading && (plansOutcome?.failed ?? false)

  const create = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await orgCreatePlan(auth0Id, {
        student_id: studentId,
        title: title.trim(),
        description: description.trim() || null,
      })
      setPlans((prev) => [res.plan, ...prev])
      setTitle('')
      setDescription('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create plan.')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (id: string, status: 'active' | 'done' | 'archived') => {
    setBusy(true)
    try {
      const res = await orgSetPlanStatus(auth0Id, id, status)
      setPlans((prev) => prev.map((p) => (p.id === id ? res.plan : p)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section
        title="Training plans"
        actions={
          canWrite ? (
            <Button
              size="sm"
              onClick={() => {
                setError(null)
                setOpen(true)
              }}
            >
              New plan
            </Button>
          ) : undefined
        }
      >
        <p className="mb-3 text-meta text-muted-foreground">
          Longer-running programs above day-to-day objectives.
        </p>
        <div>
          {plansLoading ? (
            <p className="text-meta text-muted-foreground">Loading training plans…</p>
          ) : plansFailed ? (
            // "No training plans yet." would be a lie in the useful direction: it tells
            // the reader to go write one, when the real answer is that the list could not
            // be read. Distinct copy, because the reader's next action differs.
            <p className="text-meta text-muted-foreground">
              Training plans failed to load. This is a loading problem, not an empty list —
              reload the page.
            </p>
          ) : plans.length === 0 ? (
            <p className="text-meta text-muted-foreground">No training plans yet.</p>
          ) : null}
          {/* Gated on `plansLoading` as well, so the previously selected player's rows
              cannot sit underneath a "loading" line for the newly selected one. */}
          {!plansLoading &&
            plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 hover:bg-accent/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-foreground">{plan.title}</p>
                  {plan.description && (
                    <p className="mt-0.5 text-meta text-muted-foreground line-clamp-2">
                      {plan.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={PLAN_TONE[plan.status] ?? 'gray'}>
                    <span className="capitalize">{plan.status}</span>
                  </StatusPill>
                  {plan.status !== 'done' && canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setStatus(plan.id, 'done')}
                    >
                      Done
                    </Button>
                  )}
                  {plan.status === 'done' && canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setStatus(plan.id, 'active')}
                    >
                      Reopen
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await orgDeletePlan(auth0Id, plan.id)
                          setPlans((prev) => prev.filter((p) => p.id !== plan.id))
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </Section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New training plan</DialogTitle>
            <DialogDescription>A program spanning multiple sessions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="plan-title">Title</Label>
              <Input
                id="plan-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 6-week first-touch program"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-desc">Description</Label>
              <Textarea
                id="plan-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            {error && <p className="text-meta text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={create}>
              {busy ? 'Creating…' : 'Create plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
