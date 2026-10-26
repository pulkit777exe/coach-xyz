'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Textarea } from '@/components/9ui/ui/textarea'
import TimestampPill from '@/components/TimestampPill'
import Section from '@/components/org/Section'
import StatusPill, { type StatusTone } from '@/components/org/StatusPill'
import EmptyState from '@/components/org/EmptyState'
import { orgCreateObjective, orgDeleteObjective, orgObjectives, orgSetObjectiveStatus } from '@/lib/org/objectives'
import { orgStudentFindings, downloadStudentFindingsCsv } from '@/lib/org/findings'
import { type StoredFinding, type TrainingObjective } from '@/lib/org/types'
import { getFindingsTrends, type FindingsTrendPoint } from '@/lib/library'

interface ObjectivesSectionProps {
  auth0Id: string
  studentId: string
  /** Objective writes (create/status/delete) — player.manage, enforced server-side. */
  canWrite: boolean
}

export default function ObjectivesSection({
  auth0Id,
  studentId,
  canWrite,
}: ObjectivesSectionProps) {
  // `null` means "not loaded yet" — distinct from `[]`, which means "loaded, and there
  // are none". Each fetch also carries its own failure flag, because collapsing a
  // rejection to `[]` conflates three different answers into one indistinguishable
  // empty list. See the effect below for what that cost.
  const [objectives, setObjectives] = useState<TrainingObjective[] | null>(null)
  const [findings, setFindings] = useState<StoredFinding[] | null>(null)
  const [trends, setTrends] = useState<FindingsTrendPoint[] | null>(null)
  const [objectivesFailed, setObjectivesFailed] = useState(false)
  const [findingsFailed, setFindingsFailed] = useState(false)
  const [trendsFailed, setTrendsFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [findingId, setFindingId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'list' | 'board'>('board')

  useEffect(() => {
    let cancelled = false
    // Every one of these previously set its list to `[]` on rejection, which merged
    // "failed" with "empty". The trends one is the reason this matters: `total` is
    // summed from `trends`, so a failed fetch rendered the confident, wrong sentence
    // "0 findings in 30 days" — a fabricated statistic rather than a missing one.
    void orgObjectives(auth0Id, { studentId })
      .then((res) => {
        if (!cancelled) setObjectives(res.objectives)
      })
      .catch(() => {
        if (!cancelled) {
          setObjectives([])
          setObjectivesFailed(true)
        }
      })
    void orgStudentFindings(auth0Id, studentId, 10)
      .then((res) => {
        if (!cancelled) setFindings(res.findings)
      })
      .catch(() => {
        if (!cancelled) {
          setFindings([])
          setFindingsFailed(true)
        }
      })
    void getFindingsTrends(auth0Id, { days: 30, studentId })
      .then((res) => {
        if (!cancelled) setTrends(res.trends)
      })
      .catch(() => {
        if (!cancelled) {
          setTrends([])
          setTrendsFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  // Only meaningful once `trends` has resolved; the sentence below checks
  // `trendsFailed` before printing either figure.
  const total = (trends ?? []).reduce((n, p) => n + p.count, 0)
  const reviewOpen = (trends ?? []).reduce((n, p) => n + p.needs_review, 0)

  // Weekly measurement (§26): findings observed vs objectives completed.
  const weeks = useMemo(() => {
    const buckets = new Map<string, { findings: number; done: number }>()
    const keyOf = (d: Date) => {
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
      return monday.toISOString().slice(0, 10)
    }
    for (const p of trends ?? []) {
      const key = keyOf(new Date(`${p.day}T00:00:00Z`))
      const b = buckets.get(key) ?? { findings: 0, done: 0 }
      b.findings += p.count
      buckets.set(key, b)
    }
    for (const o of objectives ?? []) {
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
    setBusy(true)
    setError(null)
    try {
      const linked = (findings ?? []).find((f) => f.id === findingId)
      const res = await orgCreateObjective(auth0Id, {
        student_id: studentId,
        finding_id: findingId || null,
        analysis_job_id: linked?.server_job_id ?? null,
        title: title.trim(),
        description: description.trim() || null,
        due_on: dueOn || null,
      })
      // `(prev ?? [])`, not `(prev ?? [res.objective])`: a successful create is real
      // data and belongs at the top, even if the initial list never arrived.
      setObjectives((prev) => [res.objective, ...(prev ?? [])])
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
      // `?? []` rather than a non-null assertion: the handlers are only reachable from
      // the rendered list, but a write racing a failed initial load should degrade to
      // "no rows" instead of throwing inside a state updater.
      setObjectives((prev) => (prev ?? []).map((o) => (o.id === id ? res.objective : o)))
    } finally {
      setBusy(false)
    }
  }

  const removeObjective = async (id: string) => {
    setBusy(true)
    try {
      await orgDeleteObjective(auth0Id, id)
      setObjectives((prev) => (prev ?? []).filter((o) => o.id !== id))
    } finally {
      setBusy(false)
    }
  }

  const openNewObjective = () => {
    setError(null)
    setOpen(true)
  }

  return (
    <Section
      title="Training objectives"
      actions={
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Objectives layout"
            className="flex rounded-[6px] bg-accent p-0.5"
          >
            {(['list', 'board'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-[4px] px-2.5 py-1 text-meta font-medium capitalize transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                  view === v
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {canWrite && (
            <Button size="sm" onClick={openNewObjective}>
              New objective
            </Button>
          )}
        </div>
      }
    >
      <p className="mb-3 text-meta leading-[1.5] text-muted-foreground">
        Findings → objectives → training → measurement.{' '}
        {/* A number is a claim about the player's record. When the trends read failed
            there is no claim to make, so say that instead of summing an empty array
            into a confident "0 findings in 30 days". */}
        {trendsFailed ? (
          'findings count unavailable.'
        ) : (
          <>
            <span className="tabular-nums">{total}</span> findings in 30 days
            {reviewOpen > 0 ? (
              <>
                {' · '}
                <span className="tabular-nums">{reviewOpen}</span> need review
              </>
            ) : null}
            .
          </>
        )}
      </p>

      <div className="space-y-2">
        {objectives === null ? (
          <p className="py-6 text-center text-body text-muted-foreground">Loading objectives…</p>
        ) : objectivesFailed ? (
          // "No objectives yet" here would be a lie in the useful direction: it tells
          // a coach to go create one, when the real answer is that the list could not
          // be read. Distinct copy, because the reader's next action differs.
          <EmptyState
            compact
            title="Objectives failed to load."
            description="This is a loading problem, not an empty roster — retry the page."
          />
        ) : objectives.length === 0 ? (
          <EmptyState
            compact
            title="No objectives yet"
            description="Create one from a recent finding below."
          />
        ) : view === 'board' ? (
          <ObjectiveBoard
            objectives={objectives}
            busy={busy}
            onStatus={setStatus}
            onDelete={removeObjective}
            onNew={openNewObjective}
            canWrite={canWrite}
          />
        ) : (
          objectives.map((objective) => (
            <div
              key={objective.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium leading-[1.4] text-foreground">
                  {objective.title}
                </p>
                {objective.description && (
                  <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">
                    {objective.description}
                  </p>
                )}
                <p className="mt-1 text-meta text-muted-foreground/60">
                  {objective.finding_id ? `from finding ${objective.finding_id.slice(-8)} · ` : ''}
                  {objective.due_on ? `due ${objective.due_on} · ` : ''}
                  {objective.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  tone={
                    objective.status === 'done'
                      ? 'green'
                      : objective.status === 'active'
                        ? 'amber'
                        : 'gray'
                  }
                >
                  {objective.status}
                </StatusPill>
                {objective.status !== 'done' && canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStatus(objective.id, 'done')}
                  >
                    Done
                  </Button>
                )}
                {objective.status === 'done' && canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStatus(objective.id, 'active')}
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
                    onClick={() => void removeObjective(objective.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))
        )}

        {weeks.length > 0 && (
          <div className="pt-3">
            <p className="mb-2 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Weekly measurement · findings vs objectives done
            </p>
            <div
              className="flex h-20 items-end gap-2"
              role="img"
              aria-label="Weekly findings versus objectives completed"
            >
              {weeks.map(([week, w]) => (
                <div
                  key={week}
                  className="flex h-full flex-1 items-end justify-center gap-0.5"
                  title={`${week}: ${w.findings} findings, ${w.done} done`}
                >
                  <div
                    className="min-h-[3px] w-2 rounded-[2px] bg-primary/70"
                    style={{ height: `${Math.max(3, Math.round((w.findings / weekMax) * 100))}%` }}
                  />
                  <div
                    className="min-h-[3px] w-2 rounded-[2px] bg-success/80"
                    style={{ height: `${Math.max(3, Math.round((w.done / weekMax) * 100))}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-4 text-meta text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-[2px] bg-primary/70" /> findings
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-[2px] bg-success/80" /> objectives done
              </span>
            </div>
          </div>
        )}

        {findingsFailed && (
          <p className="pt-3 text-meta text-muted-foreground">Recent findings failed to load.</p>
        )}

        {findings !== null && findings.length > 0 && (
          <div className="pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Recent findings
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-meta"
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-muted px-3 py-2"
                >
                  <p className="min-w-0 flex-1 text-meta text-foreground">
                    <TimestampPill seconds={(finding.start_ms ?? 0) / 1000} />{' '}
                    <span className="capitalize">
                      {(finding.category ?? 'technique').replace(/_/g, ' ')}
                    </span>
                    {finding.observation ? ` — ${finding.observation}` : ''}
                  </p>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-meta"
                      onClick={() => {
                        setFindingId(finding.id)
                        setTitle(finding.observation ?? '')
                        setError(null)
                        setOpen(true)
                      }}
                    >
                      Make objective
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
                  items={{
                    '': 'None',
                    ...Object.fromEntries((findings ?? []).map((f) => [f.id, f.id])),
                  }}
                  value={findingId}
                  onValueChange={(v) => setFindingId(typeof v === 'string' ? v : '')}
                >
                  <SelectTrigger id="objective-finding">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(findings ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.id.slice(-12)} · {(f.category ?? '').replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error ? <p className="text-meta text-destructive">{error}</p> : null}
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
    </Section>
  )
}

const BOARD_COLUMNS = [
  { status: 'active', label: 'To do', tone: 'gray' as StatusTone },
  { status: 'done', label: 'Done', tone: 'green' as StatusTone },
  { status: 'archived', label: 'Archived', tone: 'blue' as StatusTone },
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
  canWrite,
}: {
  objectives: TrainingObjective[]
  busy: boolean
  onStatus: (id: string, status: 'active' | 'done' | 'archived') => void
  onDelete: (id: string) => void
  onNew: () => void
  canWrite: boolean
}) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-3">
      {BOARD_COLUMNS.map((col) => {
        const cards = objectives.filter((o) => o.status === col.status)
        return (
          <div key={col.status}>
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <StatusPill tone={col.tone}>{col.label}</StatusPill>
              <span className="text-meta tabular-nums text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {cards.map((o) => (
                <div key={o.id} className="rounded-[6px] border border-border bg-card p-3">
                  <p className="text-body font-medium leading-snug text-foreground">{o.title}</p>
                  {o.description && (
                    <p className="mt-1 text-meta leading-relaxed text-muted-foreground line-clamp-2">
                      {o.description}
                    </p>
                  )}
                  <p className="mt-1.5 text-meta text-muted-foreground/60">
                    {o.finding_id ? `finding ${o.finding_id.slice(-8)} · ` : ''}
                    {o.due_on ? `due ${o.due_on}` : 'no due date'}
                  </p>
                  {canWrite && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {o.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-meta"
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
                          className="h-7 text-meta"
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
                          className="h-7 text-meta"
                          disabled={busy}
                          onClick={() => onStatus(o.id, 'active')}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-meta text-muted-foreground"
                          disabled={busy}
                          onClick={() => onStatus(o.id, 'archived')}
                        >
                          Archive
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-meta text-destructive"
                        disabled={busy}
                        onClick={() => void onDelete(o.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {canWrite && (
                <button
                  type="button"
                  onClick={onNew}
                  className="flex h-9 items-center gap-1 rounded-[4px] px-2 text-left text-meta text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span aria-hidden="true">+</span> New page
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
