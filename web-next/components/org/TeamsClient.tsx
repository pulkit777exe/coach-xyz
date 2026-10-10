'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  orgCreateMatch,
  orgCreateSeason,
  orgDeleteMatch,
  orgDeleteSeason,
  orgMatches,
  type Match,
  type Season,
} from '@/lib/org'
import { getFindingsTrends, type FindingsTrendPoint } from '@/lib/api'
import EmptyState from './EmptyState'
import Section from './Section'
import type { Student } from '@/lib/org'

interface TeamsClientProps {
  auth0Id: string
  initialTeams: Team[]
  initialSeasons: Season[]
  students: Student[]
  /** Team-scoped writes (create/rename/members/seasons/matches) — team.manage. */
  canManage: boolean
  /** Team deletion — pinned to the server's owner/admin floor. */
  canDeleteTeam: boolean
  /**
   * The server's team list rejected, so `initialTeams` is empty because nothing
   * arrived rather than because the club has no teams. Defaults false so the a11y
   * render sweep (which has no server read) keeps plain empty semantics.
   */
  teamsFailed?: boolean
  /** Same distinction for `initialSeasons`. */
  seasonsFailed?: boolean
  /** Same distinction for `students`, which populates the Teams→Players picker. */
  studentsFailed?: boolean
}

function TrendBars({
  points,
  loading,
  failed,
}: {
  points: FindingsTrendPoint[]
  loading: boolean
  failed: boolean
}) {
  const days = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const p of points) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.count)
    return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-14)
  }, [points])
  const max = Math.max(1, ...days.map(([, n]) => n))
  // Checked before the empty branch. "No findings in this window." is a claim about
  // fourteen days of a team's record, and a failed read is not that claim.
  if (loading) {
    return <p className="text-meta text-muted-foreground">Loading findings…</p>
  }
  if (failed) {
    return <p className="text-meta text-muted-foreground">Findings failed to load.</p>
  }
  if (days.length === 0) {
    return <p className="text-meta text-muted-foreground">No findings in this window.</p>
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

export default function TeamsClient({
  auth0Id,
  initialTeams,
  initialSeasons,
  students,
  canManage,
  canDeleteTeam,
  teamsFailed = false,
  seasonsFailed = false,
  studentsFailed = false,
}: TeamsClientProps) {
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const [seasons, setSeasons] = useState<Season[]>(initialSeasons)
  const [matches, setMatches] = useState<Match[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialTeams[0]?.id ?? null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [trends, setTrends] = useState<FindingsTrendPoint[]>([])
  // The three panel reads below each collapsed a rejection to `[]`, merging "still
  // loading", "could not read it" and "genuinely empty" into one state — and since all
  // three start as `[]`, EVERY first mount flashed "0 members", "No findings in this
  // window.", "No members yet" and "No matches scheduled" before they resolved.
  //
  // `panelLoadedFor` records WHICH team the panel has settled for, and the three states
  // are DERIVED from it rather than reset in the effect body (a synchronous setState in
  // an effect is the thing this repo's re-render rules exist to prevent). Keying on the
  // team id also closes a second hole: `selectedId` changing used to leave the previous
  // team's rows on screen, so one coach saw another roster's "12 members".
  const [panelLoadedFor, setPanelLoadedFor] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<{
    teamId: string
    members: boolean
    trends: boolean
    matches: boolean
  } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [sport, setSport] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [addKind, setAddKind] = useState<'coach' | 'player'>('player')
  const [addRef, setAddRef] = useState('')
  const [seasonName, setSeasonName] = useState('')
  const [matchOpponent, setMatchOpponent] = useState('')
  const [matchOn, setMatchOn] = useState('')
  const [matchSeason, setMatchSeason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = teams.find((t) => t.id === selectedId) ?? null
  const [renameFor, setRenameFor] = useState<string | null>(null)
  if (selected && renameFor !== selected.id) {
    setRenameFor(selected.id)
    setRenameValue(selected.name)
  }

  // Derived, not stored: the panel is loading whenever the settled team is not the one
  // on screen, which covers the first mount, every team switch, and the brief window
  // after a write re-fetches. `panelError` is read the same way, so a failure recorded
  // against team A cannot be shown while team B is selected.
  const panelLoading = selectedId !== null && panelLoadedFor !== selectedId
  const membersFailed = !panelLoading && panelError?.teamId === selectedId && panelError.members
  const trendsFailed = !panelLoading && panelError?.teamId === selectedId && panelError.trends
  const matchesFailed = !panelLoading && panelError?.teamId === selectedId && panelError.matches

  // The four write handlers below capture `selected.id` when clicked, then re-read
  // that team's list once the write lands. The team rail is NOT disabled while
  // `busy`, so a coach can switch teams mid-write — and the follow-up response then
  // arrives for the team they LEFT. Applying it would drop team A's rows into team B's
  // panel, which `panelLoadedFor` already records as settled for B: a cross-entity
  // stale write that no loading flag would ever hide, and one that persists because
  // nothing re-reads after it lands. Mirror the live selection so each follow-up can
  // refuse instead.
  const selectedIdRef = useRef(selectedId)
  /**
   * The only place the selection changes: state and its mirror move together, from an
   * event handler or an async callback — never during render (`react-hooks/refs`).
   * The mirror cannot live in an effect instead of here: these write handlers settle
   * inside promise callbacks, which can run in the microtask window between a
   * `setSelectedId` commit and its passive effect, and that is exactly the moment a
   * follow-up read lands for the team the coach just left.
   */
  const selectTeam = (id: string | null) => {
    selectedIdRef.current = id
    setSelectedId(id)
  }
  const stillOnTeam = (teamId: string) => selectedIdRef.current === teamId

  useEffect(() => {
    const id = selectedId
    if (!id) return
    let cancelled = false
    // Each read reports its own outcome. The lists still reset to `[]` on failure so the
    // downstream `.map`/`.length` stay total, but the failure is recorded rather than
    // being the only thing the render can see — `[]` is also what a real empty answer
    // looks like, which is the whole defect.
    const error = { members: false, trends: false, matches: false }
    const reads = [
      listTeamMembers(auth0Id, id)
        .then((res) => {
          if (!cancelled) setMembers(res.members)
        })
        .catch(() => {
          error.members = true
          if (!cancelled) setMembers([])
        }),
      getFindingsTrends(auth0Id, { days: 14, teamId: id })
        .then((res) => {
          if (!cancelled) setTrends(res.trends)
        })
        .catch(() => {
          error.trends = true
          if (!cancelled) setTrends([])
        }),
      orgMatches(auth0Id, { teamId: id })
        .then((res) => {
          if (!cancelled) setMatches(res.matches)
        })
        .catch(() => {
          error.matches = true
          if (!cancelled) setMatches([])
        }),
    ]
    // Resolves once all three have settled either way, so "loaded" means "the panel has
    // an answer for this team" — which is what stops the empty states from flashing on
    // every visit. Recorded as one object so a partial failure keeps its three answers
    // apart rather than collapsing into a single boolean.
    void Promise.all(reads).then(() => {
      if (cancelled) return
      setPanelLoadedFor(id)
      setPanelError((prev) =>
        prev?.teamId === id ? prev : { teamId: id, ...error },
      )
    })
    return () => {
      cancelled = true
    }
  }, [auth0Id, selectedId])

  const refreshTeams = async (selectId?: string) => {
    const { listTeams } = await import('@/lib/teams')
    const res = await listTeams(auth0Id)
    setTeams(res.teams)
    if (selectId) selectTeam(selectId)
    else if (!res.teams.some((t) => t.id === selectedId)) {
      selectTeam(res.teams[0]?.id ?? null)
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

  // A successful write re-reads its list below. That re-read is itself proof the list can
  // be read now, so the failure flag has to be cleared with it — otherwise the panel
  // keeps announcing "failed to load" on top of rows that just arrived.
  const clearPanelFailure = (kind: 'members' | 'matches') =>
    setPanelError((prev) =>
      prev?.teamId === selectedId && prev[kind] ? { ...prev, [kind]: false } : prev,
    )

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
    <div className="space-y-6">
      <Section title="Seasons">
        <div className="flex flex-wrap gap-2">
          {seasons.map((season) => (
            <span
              key={season.id}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-2.5 py-1 text-label font-medium text-muted-foreground"
            >
              {season.name}
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await orgDeleteSeason(auth0Id, season.id)
                      setSeasons((prev) => prev.filter((s) => s.id !== season.id))
                    })
                  }
                  className="text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded"
                  aria-label={`Delete season ${season.name}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {seasons.length === 0 && (
            <span className="text-meta text-muted-foreground">
              {seasonsFailed ? 'Seasons failed to load.' : 'No seasons yet.'}
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2 mt-3">
            <Input
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              placeholder="2026 season"
              aria-label="Season name"
              className="h-9 max-w-56"
            />
            <Button
              variant="outline"
              disabled={busy || !seasonName.trim()}
              onClick={() =>
                run(async () => {
                  const res = await orgCreateSeason(auth0Id, { name: seasonName.trim() })
                  setSeasons((prev) => [res.season, ...prev])
                  setSeasonName('')
                })
              }
            >
              Add season
            </Button>
          </div>
        )}
        {error && <p className="text-meta text-destructive mt-2">{error}</p>}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Section title="Teams">
          <div className="space-y-1">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => selectTeam(team.id)}
                aria-pressed={team.id === selectedId}
                className={`w-full text-left rounded-[4px] px-3 py-2 transition-colors ${
                  team.id === selectedId
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <p className="text-body font-medium text-foreground">{team.name}</p>
                {team.sport && (
                  <p className="text-meta text-muted-foreground capitalize">{team.sport}</p>
                )}
              </button>
            ))}
          </div>
          {teams.length === 0 && (
            <EmptyState
              compact
              // A failed read is not an org with no teams, and "Create your first team"
              // here invites a duplicate of a team that already exists.
              title={teamsFailed ? 'Teams failed to load.' : 'No teams yet'}
              description={
                teamsFailed
                  ? 'This is a loading problem, not an empty club — reload the page to try again.'
                  : 'Create your first team to scope coaching and trends.'
              }
            />
          )}
          {canManage && (
            <Button className="w-full mt-3" onClick={() => setCreateOpen(true)}>
              New team
            </Button>
          )}
          {error && <p className="text-meta text-destructive mt-2">{error}</p>}
        </Section>

        <div className="space-y-6">
          {selected ? (
            <>
              <Section
                title={selected.name}
                actions={
                  canManage || canDeleteTeam ? (
                    <div className="flex gap-2">
                      {canManage && (
                        <>
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label="Team name"
                            className="h-9 w-44"
                          />
                          <Button
                            variant="outline"
                            size="sm"
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
                        </>
                      )}
                      {canDeleteTeam && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive border-destructive/30"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await deleteTeam(auth0Id, selected.id)
                              selectTeam(null)
                              await refreshTeams()
                            })
                          }
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
              >
                <p className="text-meta text-muted-foreground mb-3">
                  {/* "0 members" was the worst of the four claims: a fabricated count,
                      printed as a confident figure beside a coach's real roster. */}
                  {panelLoading
                    ? 'Loading members…'
                    : membersFailed
                      ? 'Member count unavailable'
                      : `${members.length} member${members.length === 1 ? '' : 's'}`}
                  {selected.sport ? ` · ${selected.sport}` : ''}
                </p>
                <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground mb-2">
                  Findings · last 14 days
                </p>
                <TrendBars points={trends} loading={panelLoading} failed={trendsFailed} />
              </Section>

              <Section title="Members">
                <p className="text-meta text-muted-foreground mb-3">
                  Coaches by account, players by roster row.
                </p>
                <div className="space-y-1">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-[4px] px-3 py-2 hover:bg-accent transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-body font-medium text-foreground truncate">
                          {member.member_auth0_id ??
                            students.find((s) => s.id === member.student_id)?.full_name ??
                            'Unknown'}
                        </p>
                        <span className="mt-1 inline-flex h-[20px] items-center rounded-full bg-muted px-2 text-label font-medium leading-none text-muted-foreground capitalize">
                          {member.role}
                        </span>
                      </div>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const teamId = selected.id
                              await removeTeamMember(auth0Id, teamId, member.id)
                              const res = await listTeamMembers(auth0Id, teamId)
                              // Refuse rather than paint another team's roster.
                              if (!stillOnTeam(teamId)) return
                              setMembers(res.members)
                              clearPanelFailure('members')
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {panelLoading ? (
                  <p className="py-2 text-meta text-muted-foreground">Loading members…</p>
                ) : membersFailed ? (
                  <EmptyState
                    compact
                    title="Members failed to load."
                    description="This is a loading problem, not an empty roster — reload the page to try again."
                  />
                ) : members.length === 0 ? (
                  <EmptyState
                    compact
                    title="No members yet"
                    description="Add coaches by account or players from the roster."
                  />
                ) : null}
                {canManage && (
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
                    ) : studentsFailed ? (
                      // The roster read failed, so this picker has nobody in it. An empty
                      // "Select player" dropdown reads as "no unassigned players exist",
                      // which is a different claim — say why it is empty instead.
                      <p className="flex-1 min-w-44 text-meta text-muted-foreground">
                        Players failed to load, so nobody can be picked here — reload the page.
                      </p>
                    ) : (
                      <Select
                        items={Object.fromEntries(
                          unassignedStudents.map((s) => [s.id, s.full_name]),
                        )}
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
                          const teamId = selected.id
                          await addTeamMember(auth0Id, teamId, {
                            ...(addKind === 'coach'
                              ? { member_auth0_id: addRef.trim(), role: 'coach' as const }
                              : { student_id: addRef, role: 'player' as const }),
                          })
                          setAddRef('')
                          const res = await listTeamMembers(auth0Id, teamId)
                          if (!stillOnTeam(teamId)) return
                          setMembers(res.members)
                          clearPanelFailure('members')
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                )}
              </Section>

              <Section title="Matches">
                <p className="text-meta text-muted-foreground mb-3">
                  Fixtures and results for this team.
                </p>
                <div className="space-y-1">
                  {panelLoading ? (
                    <p className="py-2 text-meta text-muted-foreground">Loading matches…</p>
                  ) : matchesFailed ? (
                    <EmptyState
                      compact
                      title="Matches failed to load."
                      description="This is a loading problem, not an empty fixture list — reload the page to try again."
                    />
                  ) : matches.length === 0 ? (
                    <EmptyState
                      compact
                      title="No matches scheduled"
                      description="Add the next fixture for this team."
                    />
                  ) : null}
                  {matches.map((match) => (
                    <div
                      key={match.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] px-3 py-2.5 hover:bg-accent transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-body font-medium text-foreground">
                          {match.opponent ? `vs ${match.opponent}` : 'Match'}
                          {match.result ? ` · ${match.result}` : ''}
                        </p>
                        <p className="text-meta text-muted-foreground tabular-nums">
                          {[match.match_on, match.location].filter(Boolean).join(' · ') ||
                            'Unscheduled'}
                        </p>
                      </div>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const teamId = selected.id
                              await orgDeleteMatch(auth0Id, match.id)
                              const res = await orgMatches(auth0Id, { teamId })
                              if (!stillOnTeam(teamId)) return
                              setMatches(res.matches)
                              clearPanelFailure('matches')
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {canManage && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Input
                        value={matchOpponent}
                        onChange={(e) => setMatchOpponent(e.target.value)}
                        placeholder="Opponent"
                        aria-label="Opponent"
                        className="h-9 flex-1 min-w-32"
                      />
                      <Input
                        type="date"
                        value={matchOn}
                        onChange={(e) => setMatchOn(e.target.value)}
                        aria-label="Match date"
                        className="h-9 w-36"
                      />
                      <Select
                        items={{
                          __none: 'No season',
                          ...Object.fromEntries(seasons.map((s) => [s.id, s.name])),
                        }}
                        value={matchSeason || '__none'}
                        onValueChange={(v) =>
                          setMatchSeason(v === '__none' ? '' : typeof v === 'string' ? v : '')
                        }
                      >
                        <SelectTrigger aria-label="Season" className="w-36">
                          <SelectValue placeholder="No season" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">No season</SelectItem>
                          {seasons.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        disabled={busy || !matchOpponent.trim()}
                        onClick={() =>
                          run(async () => {
                            const teamId = selected.id
                            await orgCreateMatch(auth0Id, {
                              team_id: teamId,
                              season_id: matchSeason || null,
                              opponent: matchOpponent.trim(),
                              match_on: matchOn || null,
                            })
                            setMatchOpponent('')
                            setMatchOn('')
                            setMatchSeason('')
                            const res = await orgMatches(auth0Id, { teamId })
                            if (!stillOnTeam(teamId)) return
                            setMatches(res.matches)
                            clearPanelFailure('matches')
                          })
                        }
                      >
                        Add match
                      </Button>
                    </div>
                  )}
                </div>
              </Section>
            </>
          ) : (
            <div className="rounded-[6px] border border-border bg-card py-10 text-center text-body text-muted-foreground">
              Select a team to manage members and see trends.
            </div>
          )}
        </div>
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
