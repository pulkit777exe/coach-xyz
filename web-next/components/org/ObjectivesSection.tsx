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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Textarea } from '@/components/9ui/ui/textarea'
import {
  orgCreateObjective,
  orgDeleteObjective,
  orgObjectives,
  orgSetObjectiveStatus,
  orgStudentFindings,
  type StoredFinding,
  type TrainingObjective,
} from '@/lib/org'
import { getFindingsTrends, type FindingsTrendPoint } from '@/lib/api'

interface ObjectivesSectionProps {
  auth0Id: string
  studentId: string
}

export default function ObjectivesSection({ auth0Id, studentId }: ObjectivesSectionProps) {
  const [objectives, setObjectives] = useState<TrainingObjective[]>([])
  const [findings, setFindings] = useState<StoredFinding[]>([])
  const [trends, setTrends] = useState<FindingsTrendPoint[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [findingId, setFindingId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void orgObjectives(auth0Id, { studentId })
      .then((res) => {
        if (!cancelled) setObjectives(res.objectives)
      })
      .catch(() => {
        if (!cancelled) setObjectives([])
      })
    void orgStudentFindings(auth0Id, studentId, 10)
      .then((res) => {
        if (!cancelled) setFindings(res.findings)
      })
      .catch(() => {
        if (!cancelled) setFindings([])
      })
    void getFindingsTrends(auth0Id, { days: 30, studentId })
      .then((res) => {
        if (!cancelled) setTrends(res.trends)
      })
      .catch(() => {
        if (!cancelled) setTrends([])
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  const total = trends.reduce((n, p) => n + p.count, 0)
  const reviewOpen = trends.reduce((n, p) => n + p.needs_review, 0)

  const create = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const linked = findings.find((f) => f.id === findingId)
      const res = await orgCreateObjective(auth0Id, {
        student_id: studentId,
        finding_id: findingId || null,
        analysis_job_id: linked?.server_job_id ?? null,
        title: title.trim(),
        description: description.trim() || null,
        due_on: dueOn || null,
      })
      setObjectives((prev) => [res.objective, ...prev])
      setTitle('')
      setDescription('')
      setDueOn('')
      setFindingId('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create objective.')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (id: string, status: 'active' | 'done' | 'archived') => {
    setBusy(true)
    try {
      const res = await orgSetObjectiveStatus(auth0Id, id, status)
      setObjectives((prev) => prev.map((o) => (o.id === id ? res.objective : o)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Training objectives</CardTitle>
            <CardDescription>
              Findings → objectives → training → measurement. {total} findings in 30 days
              {reviewOpen > 0 ? ` · ${reviewOpen} need review` : ''}.
            </CardDescription>
          </div>
          <Button onClick={() => { setError(null); setOpen(true) }}>New objective</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {objectives.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No objectives yet — create one from a recent finding below.
          </p>
        )}
        {objectives.map((objective) => (
          <div
            key={objective.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{objective.title}</p>
              {objective.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{objective.description}</p>
              )}
              <p className="mt-1 text-[0.65rem] text-muted-foreground">
                {objective.finding_id ? `from finding ${objective.finding_id.slice(-8)} · ` : ''}
                {objective.due_on ? `due ${objective.due_on} · ` : ''}
                {objective.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">{objective.status}</Badge>
              {objective.status !== 'done' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(objective.id, 'done')}>
                  Done
                </Button>
              )}
              {objective.status === 'done' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(objective.id, 'active')}>
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
                    await orgDeleteObjective(auth0Id, objective.id)
                    setObjectives((prev) => prev.filter((o) => o.id !== objective.id))
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

        {findings.length > 0 && (
          <div className="pt-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Recent findings
            </p>
            <div className="space-y-1.5">
              {findings.slice(0, 5).map((finding) => (
                <div
                  key={finding.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2"
                >
                  <p className="text-xs text-foreground min-w-0 flex-1">
                    <span className="font-mono text-muted-foreground">
                      {finding.start_ms != null ? `${(finding.start_ms / 1000).toFixed(1)}s` : '—'}
                    </span>{' '}
                    <span className="capitalize">{(finding.category ?? 'technique').replace(/_/g, ' ')}</span>
                    {finding.observation ? ` — ${finding.observation}` : ''}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setFindingId(finding.id)
                      setTitle(finding.observation ?? '')
                      setError(null)
                      setOpen(true)
                    }}
                  >
                    Make objective
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New objective</DialogTitle>
            <DialogDescription>Optionally linked to the finding that motivated it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="objective-title">Title</Label>
              <Input
                id="objective-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Keep the head still through release"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="objective-desc">Description</Label>
              <Textarea
                id="objective-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="objective-due">Due date</Label>
                <Input
                  id="objective-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="objective-finding">Linked finding</Label>
                <Select
                  items={{ '': 'None', ...Object.fromEntries(findings.map((f) => [f.id, f.id])) }}
                  value={findingId}
                  onValueChange={(v) => setFindingId(typeof v === 'string' ? v : '')}
                >
                  <SelectTrigger id="objective-finding">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {findings.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.id.slice(-12)} · {(f.category ?? '').replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={create}>
              {busy ? 'Creating…' : 'Create objective'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
