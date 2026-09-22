'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/9ui/ui/badge'
import { Button } from '@/components/9ui/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/9ui/ui/card'
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
import {
  orgCreatePlan,
  orgDeletePlan,
  orgPlans,
  orgSetPlanStatus,
  type TrainingPlan,
} from '@/lib/org'

interface PlansSectionProps {
  auth0Id: string
  studentId: string
}

export default function PlansSection({ auth0Id, studentId }: PlansSectionProps) {
  const [plans, setPlans] = useState<TrainingPlan[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void orgPlans(auth0Id, { studentId })
      .then((res) => {
        if (!cancelled) setPlans(res.plans)
      })
      .catch(() => {
        if (!cancelled) setPlans([])
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Training plans</CardTitle>
            <CardDescription>Longer-running programs above day-to-day objectives.</CardDescription>
          </div>
          <Button
            onClick={() => {
              setError(null)
              setOpen(true)
            }}
          >
            New plan
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">No training plans yet.</p>
        )}
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{plan.title}</p>
              {plan.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {plan.description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {plan.status}
              </Badge>
              {plan.status !== 'done' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStatus(plan.id, 'done')}
                >
                  Done
                </Button>
              )}
              {plan.status === 'done' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStatus(plan.id, 'active')}
                >
                  Reopen
                </Button>
              )}
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
            </div>
          </div>
        ))}
      </CardContent>

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
            {error && <p className="text-sm text-destructive">{error}</p>}
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
    </Card>
  )
}
