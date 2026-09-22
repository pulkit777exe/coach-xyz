'use client'

import { useEffect, useMemo, useState } from 'react'
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
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamMembers,
  removeTeamMember,
  renameTeam,
  type Team,
  type TeamMember,
} from '@/lib/teams'
import { getFindingsTrends, type FindingsTrendPoint } from '@/lib/api'
import type { Student } from '@/lib/org'

interface TeamsClientProps {
  auth0Id: string
  initialTeams: Team[]
  students: Student[]
}

function TrendBars({ points }: { points: FindingsTrendPoint[] }) {
  const days = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const p of points) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.count)
    return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-14)
  }, [points])
  const max = Math.max(1, ...days.map(([, n]) => n))
  if (days.length === 0) {
    return <p className="text-xs text-muted-foreground">No findings in this window.</p>
  }
  return (
    <div className="flex items-end gap-1 h-16" role="img" aria-label="Findings per day">
      {days.map(([day, n]) => (
        <div
          key={day}
          title={`${day}: ${n}`}
          className="flex-1 rounded-sm bg-primary/70 min-h-[3px]"
          style={{ height: `${Math.max(4, Math.round((n / max) * 100))}%` }}
        />
      ))}
    </div>
  )
}

export default function TeamsClient({ auth0Id, initialTeams, students }: TeamsClientProps) {
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const [selectedId, setSelectedId] = useState<string | null>(initialTeams[0]?.id ?? null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [trends, setTrends] = useState<FindingsTrendPoint[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [sport, setSport] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [addKind, setAddKind] = useState<'coach' | 'player'>('player')
  const [addRef, setAddRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = teams.find((t) => t.id === selectedId) ?? null
  const [renameFor, setRenameFor] = useState<string | null>(null)
  if (selected && renameFor !== selected.id) {
    setRenameFor(selected.id)
    setRenameValue(selected.name)
  }

  useEffect(() => {
    const id = selectedId
    if (!id) return
    let cancelled = false
    void listTeamMembers(auth0Id, id)
      .then((res) => {
        if (!cancelled) setMembers(res.members)
      })
      .catch(() => {
        if (!cancelled) setMembers([])
      })
    void getFindingsTrends(auth0Id, { days: 14, teamId: id })
      .then((res) => {
        if (!cancelled) setTrends(res.trends)
      })
      .catch(() => {
        if (!cancelled) setTrends([])
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id, selectedId])

  const refreshTeams = async (selectId?: string) => {
    const { listTeams } = await import('@/lib/teams')
    const res = await listTeams(auth0Id)
    setTeams(res.teams)
    if (selectId) setSelectedId(selectId)
    else if (!res.teams.some((t) => t.id === selectedId)) {
      setSelectedId(res.teams[0]?.id ?? null)
    }
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () =>
    run(async () => {
      const res = await createTeam(auth0Id, { name: name.trim(), sport: sport.trim() || null })
      setName('')
      setSport('')
      setCreateOpen(false)
      await refreshTeams(res.team.id)
    })

  const assignedStudentIds = new Set(members.map((m) => m.student_id).filter(Boolean))
  const unassignedStudents = students.filter((s) => !assignedStudentIds.has(s.id))

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>Groups for coaching scope and trends.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedId(team.id)}
              aria-pressed={team.id === selectedId}
              className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                team.id === selectedId
                  ? 'border-foreground bg-muted'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <p className="text-sm font-semibold text-foreground">{team.name}</p>
              {team.sport && (
                <p className="text-xs text-muted-foreground capitalize">{team.sport}</p>
              )}
            </button>
          ))}
          {teams.length === 0 && (
            <p className="text-sm text-muted-foreground">No teams yet — create one.</p>
          )}
          <Button className="w-full mt-2" onClick={() => setCreateOpen(true)}>
            New team
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {selected ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>{selected.name}</CardTitle>
                    <CardDescription>
                      {members.length} member{members.length === 1 ? '' : 's'}
                      {selected.sport ? ` · ${selected.sport}` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label="Team name"
                      className="h-9 w-44"
                    />
                    <Button
                      variant="outline"
                      disabled={busy || !renameValue.trim() || renameValue === selected.name}
                      onClick={() =>
                        run(async () => {
                          await renameTeam(auth0Id, selected.id, renameValue.trim())
                          await refreshTeams(selected.id)
                        })
                      }
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      className="text-destructive border-destructive/30"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await deleteTeam(auth0Id, selected.id)
                          setSelectedId(null)
                          await refreshTeams()
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  Findings · last 14 days
                </p>
                <TrendBars points={trends} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>Coaches by account, players by roster row.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {member.member_auth0_id ??
                          students.find((s) => s.id === member.student_id)?.full_name ??
                          'Unknown'}
                      </p>
                      <Badge variant="outline" className="mt-1 capitalize">
                        {member.role}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await removeTeamMember(auth0Id, selected.id, member.id)
                          const res = await listTeamMembers(auth0Id, selected.id)
                          setMembers(res.members)
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-sm text-muted-foreground">No members yet.</p>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Select
                    items={{ coach: 'Coach (account)', player: 'Player (roster)' }}
                    value={addKind}
                    onValueChange={(v) => {
                      if (v === 'coach' || v === 'player') {
                        setAddKind(v)
                        setAddRef('')
                      }
                    }}
                  >
                    <SelectTrigger aria-label="Member kind" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coach">Coach (account)</SelectItem>
                      <SelectItem value="player">Player (roster)</SelectItem>
                    </SelectContent>
                  </Select>
                  {addKind === 'coach' ? (
                    <Input
                      value={addRef}
                      onChange={(e) => setAddRef(e.target.value)}
                      placeholder="Coach auth0 id or email-linked id"
                      aria-label="Coach member id"
                      className="h-9 flex-1 min-w-44"
                    />
                  ) : (
                    <Select
                      items={Object.fromEntries(unassignedStudents.map((s) => [s.id, s.full_name]))}
                      value={addRef}
                      onValueChange={(v) => {
                        if (typeof v === 'string') setAddRef(v)
                      }}
                    >
                      <SelectTrigger aria-label="Player" className="flex-1 min-w-44">
                        <SelectValue placeholder="Select player" />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedStudents.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    disabled={busy || !addRef.trim()}
                    onClick={() =>
                      run(async () => {
                        await addTeamMember(auth0Id, selected.id, {
                          ...(addKind === 'coach'
                            ? { member_auth0_id: addRef.trim(), role: 'coach' as const }
                            : { student_id: addRef, role: 'player' as const }),
                        })
                        setAddRef('')
                        const res = await listTeamMembers(auth0Id, selected.id)
                        setMembers(res.members)
                      })
                    }
                  >
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Select a team to manage members and see trends.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>Teams scope coaching access and trends.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="U17 squad"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-sport">Sport (optional)</Label>
              <Input
                id="team-sport"
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                placeholder="football"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !name.trim()} onClick={handleCreate}>
              Create team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
