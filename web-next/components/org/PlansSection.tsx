'use client'

import { useState } from 'react'
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
import { useOrgCrudList } from '@/lib/useOrgCrudList'

interface PlansSectionProps {
  auth0Id: string
  studentId: string
}

export default function PlansSection({ auth0Id, studentId }: PlansSectionProps) {
  const {
    items: plans,
    isBusy: busy,
    error,
    setError,
    createItem,
    setItemStatus,
    removeItem,
  } = useOrgCrudList<
    TrainingPlan,
    {
      team_id?: string | null
      student_id?: string | null
      title: string
      description?: string | null
    },
    'active' | 'done' | 'archived'
  >({
    scopeKey: `${auth0Id}:${studentId}`,
    load: () => orgPlans(auth0Id, { studentId }).then((res) => res.plans),
    create: (input) => orgCreatePlan(auth0Id, input).then((res) => res.plan),
    setStatus: (id, status) => orgSetPlanStatus(auth0Id, id, status).then((res) => res.plan),
    remove: (id) => orgDeletePlan(auth0Id, id),
  })
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const create = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    const created = await createItem(
      {
        student_id: studentId,
        title: title.trim(),
        description: description.trim() || null,
      },
      'Could not create plan.',
    )
    if (!created) return
    setTitle('')
    setDescription('')
    setOpen(false)
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
                  onClick={() => setItemStatus(plan.id, 'done')}
                >
                  Done
                </Button>
              )}
              {plan.status === 'done' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setItemStatus(plan.id, 'active')}
                >
                  Reopen
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => void removeItem(plan.id)}
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
