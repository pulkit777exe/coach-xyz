'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
import TimestampPill from '@/components/TimestampPill'
import {
  orgStudentFindings,
  downloadStudentFindingsCsv,
  orgObjectives,
  orgCreateObjective,
  orgSetObjectiveStatus,
  orgDeleteObjective,
  type StoredFinding,
  type TrainingObjective,
} from '@/lib/org'
import { useOrgCrudList } from '@/lib/useOrgCrudList'
import { getFindingsTrends, type FindingsTrendPoint } from '@/lib/library'

interface ObjectivesSectionProps {
  auth0Id: string
  studentId: string
}

export default function ObjectivesSection({ auth0Id, studentId }: ObjectivesSectionProps) {
  const {
    items: objectives,
    isBusy: busy,
    error,
    setError,
    createItem,
    setItemStatus,
    removeItem,
  } = useOrgCrudList<
    TrainingObjective,
    {
      student_id?: string | null
      finding_id?: string | null
      analysis_job_id?: string | null
      title: string
      description?: string | null
      due_on?: string | null
    },
    'active' | 'done' | 'archived'
  >({
    scopeKey: `${auth0Id}:${studentId}`,
    load: () => orgObjectives(auth0Id, { studentId }).then((res) => res.objectives),
    create: (input) => orgCreateObjective(auth0Id, input).then((res) => res.objective),
    setStatus: (id, status) =>
      orgSetObjectiveStatus(auth0Id, id, status).then((res) => res.objective),
    remove: (id) => orgDeleteObjective(auth0Id, id),
  })
  const [findings, setFindings] = useState<StoredFinding[]>([])
  const [trends, setTrends] = useState<FindingsTrendPoint[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [findingId, setFindingId] = useState('')
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'list' | 'board'>('board')

  useEffect(() => {
    let cancelled = false
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

  // Weekly measurement (§26): findings observed vs objectives completed.
  const weeks = useMemo(() => {
    const buckets = new Map<string, { findings: number; done: number }>()
    const keyOf = (d: Date) => {
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
      return monday.toISOString().slice(0, 10)
    }
    for (const p of trends) {
      const key = keyOf(new Date(`${p.day}T00:00:00Z`))
      const b = buckets.get(key) ?? { findings: 0, done: 0 }
      b.findings += p.count
      buckets.set(key, b)
    }
    for (const o of objectives) {
      if (o.status !== 'done') continue
      const key = keyOf(new Date(o.updated_at))
      const b = buckets.get(key) ?? { findings: 0, done: 0 }
      b.done += 1
      buckets.set(key, b)
    }
    return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-8)
  }, [trends, objectives])
  const weekMax = Math.max(1, ...weeks.map(([, w]) => Math.max(w.findings, w.done)))

  const create = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    const linked = findings.find((f) => f.id === findingId)
    const created = await createItem(
      {
        student_id: studentId,
        finding_id: findingId || null,
        analysis_job_id: linked?.server_job_id ?? null,
        title: title.trim(),
        description: description.trim() || null,
        due_on: dueOn || null,
      },
      'Could not create objective.',
    )
    if (!created) return
    setTitle('')
    setDescription('')
    setDueOn('')
    setFindingId('')
    setOpen(false)
  }

  const openNewObjective = () => {
    setError(null)
    setOpen(true)
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
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Objectives layout"
              className="flex rounded-md border border-border bg-muted p-0.5"
            >
              {(['list', 'board'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    view === v
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button onClick={openNewObjective}>New objective</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {objectives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No objectives yet — create one from a recent finding below.
          </p>
        ) : view === 'board' ? (
          <ObjectiveBoard
            objectives={objectives}
            busy={busy}
            onStatus={setItemStatus}
            onDelete={removeItem}
            onNew={openNewObjective}
          />
        ) : (
          objectives.map((objective) => (
            <div
              key={objective.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{objective.title}</p>
                {objective.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {objective.description}
                  </p>
                )}
                <p className="mt-1 text-[0.65rem] text-muted-foreground">
                  {objective.finding_id ? `from finding ${objective.finding_id.slice(-8)} · ` : ''}
                  {objective.due_on ? `due ${objective.due_on} · ` : ''}
                  {objective.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {objective.status}
                </Badge>
                {objective.status !== 'done' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setItemStatus(objective.id, 'done')}
                  >
                    Done
                  </Button>
                )}
                {objective.status === 'done' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setItemStatus(objective.id, 'active')}
                  >
                    Reopen
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => void removeItem(objective.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}

        {weeks.length > 0 && (
          <div className="pt-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Weekly measurement · findings vs objectives done
            </p>
            <div
              className="flex items-end gap-2 h-20"
              role="img"
              aria-label="Weekly findings versus objectives completed"
            >
              {weeks.map(([week, w]) => (
                <div
                  key={week}
                  className="flex-1 flex items-end justify-center gap-0.5 h-full"
                  title={`${week}: ${w.findings} findings, ${w.done} done`}
                >
                  <div
                    className="w-2 rounded-sm bg-primary/70 min-h-[3px]"
                    style={{ height: `${Math.max(3, Math.round((w.findings / weekMax) * 100))}%` }}
                  />
                  <div
                    className="w-2 rounded-sm bg-emerald-500/80 min-h-[3px]"
                    style={{ height: `${Math.max(3, Math.round((w.done / weekMax) * 100))}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-1 text-[0.65rem] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm bg-primary/70" /> findings
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm bg-emerald-500/80" /> objectives
                done
              </span>
            </div>
          </div>
        )}

        {findings.length > 0 && (
          <div className="pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Recent findings
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={exporting}
                onClick={() => {
                  setExporting(true)
                  void downloadStudentFindingsCsv(auth0Id, studentId)
                    .then(() => toast.success('Findings exported'))
                    .catch((e: unknown) => {
                      toast.error(e instanceof Error ? e.message : 'Could not export findings.')
                    })
                    .finally(() => setExporting(false))
                }}
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </div>
            <div className="space-y-1.5">
              {findings.slice(0, 5).map((finding) => (
                <div
                  key={finding.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2"
                >
                  <p className="text-xs text-foreground min-w-0 flex-1">
                    <TimestampPill seconds={(finding.start_ms ?? 0) / 1000} />{' '}
                    <span className="capitalize">
                      {(finding.category ?? 'technique').replace(/_/g, ' ')}
                    </span>
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
            <DialogDescription>
              Optionally linked to the finding that motivated it.
            </DialogDescription>
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

const BOARD_COLUMNS = [
  { status: 'active', label: 'To do', dot: 'bg-primary' },
  { status: 'done', label: 'Done', dot: 'bg-emerald-500' },
  { status: 'archived', label: 'Archived', dot: 'bg-muted-foreground/60' },
] as const

/**
 * Kanban board over training objectives (Ramp-HQ style): one column per
 * status with counts, cards carry the same move/delete actions as the list
 * view. No drag-and-drop — status changes are explicit button taps.
 */
function ObjectiveBoard({
  objectives,
  busy,
  onStatus,
  onDelete,
  onNew,
}: {
  objectives: TrainingObjective[]
  busy: boolean
  onStatus: (id: string, status: 'active' | 'done' | 'archived') => void
  onDelete: (id: string) => void
  onNew: () => void
}) {
  return (
    <div className="grid items-start gap-3 md:grid-cols-3">
      {BOARD_COLUMNS.map((col) => {
        const cards = objectives.filter((o) => o.status === col.status)
        return (
          <div key={col.status} className="rounded-xl bg-muted/60 p-2">
            <p className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
              <span className={`inline-block size-2 rounded-full ${col.dot}`} />
              {col.label}
              <span className="text-muted-foreground">{cards.length}</span>
            </p>
            <div className="mt-1 flex flex-col gap-1.5">
              {cards.map((o) => (
                <div key={o.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <p className="text-[13px] font-medium leading-snug text-foreground">{o.title}</p>
                  {o.description && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                      {o.description}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {o.finding_id ? `finding ${o.finding_id.slice(-8)} · ` : ''}
                    {o.due_on ? `due ${o.due_on}` : 'no due date'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {o.status === 'active' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() => onStatus(o.id, 'done')}
                      >
                        Done
                      </Button>
                    )}
                    {o.status === 'done' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() => onStatus(o.id, 'active')}
                      >
                        Reopen
                      </Button>
                    )}
                    {o.status === 'archived' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() => onStatus(o.id, 'active')}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground"
                        disabled={busy}
                        onClick={() => onStatus(o.id, 'archived')}
                      >
                        Archive
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive"
                      disabled={busy}
                      onClick={() => void onDelete(o.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={onNew}
                className="rounded-lg px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                + New page
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
