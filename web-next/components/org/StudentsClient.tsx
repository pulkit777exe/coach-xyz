'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/9ui/ui/button'
import { downloadCSV } from '@/lib/csv'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Spinner } from './Spinner'
import StudentFormDialog from './StudentFormDialog'
import InvitePlayersDialog from './InvitePlayersDialog'
import StudentsFilters from './StudentsFilters'
import StudentsBulkActions from './StudentsBulkActions'
import StudentsTable from './StudentsTable'
import StudentImportDialog, { csvToImportRows } from './StudentImportDialog'
export { csvToImportRows }

import type { Student } from '@/lib/org/types'
import { orgDeleteStudent, orgUpdateStudent, orgStudents } from '@/lib/org/students'
import { toISODate } from '@/lib/date'
import type { CoachAIError } from '@/lib/data/errors'

/**
 * Apply a bulk status change, honouring what the server actually accepted.
 *
 * Extracted as a pure function because the invariant is the whole point and it was
 * untestable inside a 973-line component: `setStudents` runs inside `act`, `selected` is
 * component state, and the fetch is `Promise.allSettled` over injected props. So the
 * rule — *only a fulfilled write may change local state* — had no test and the version
 * that broke it shipped.
 *
 * The bug this encodes: the old code rewrote every selected row regardless of outcome,
 * so a partial failure left the roster claiming a change the server rejected while the
 * toast, built from the success count, reported "Updated 17".
 *
 * `results` must be positionally aligned with `ids` — both come from the same
 * `Promise.allSettled` over the same array, which is what pairs a result with its id.
 */
export function applyBulkStatusResult<T extends { id: string; status: Student['status'] }>(
  rows: T[],
  ids: string[],
  results: PromiseSettledResult<unknown>[],
  nextStatus: Student['status'],
): { rows: T[]; succeeded: string[]; failed: string[] } {
  const succeeded = new Set(ids.filter((_, i) => results[i]?.status === 'fulfilled'))
  return {
    rows: rows.map((r) => (succeeded.has(r.id) ? { ...r, status: nextStatus } : r)),
    succeeded: ids.filter((id) => succeeded.has(id)),
    failed: ids.filter((id) => !succeeded.has(id)),
  }
}

/**
 * Remove bulk-deleted rows, honouring what the server actually accepted.
 *
 * Same invariant as above, and the same bug in a worse place: the old code filtered on
 * the component's `selected` Set, which SURVIVES a filter change, while the request was
 * built from `selectedIds` — derived from the filtered list. So it also removed rows that
 * were never part of the request. The failed subset then vanished from the roster while
 * still holding their attendance, objectives and plans, with the selection cleared so
 * they could not be re-selected.
 */
export function applyBulkDeleteResult<T extends { id: string }>(
  rows: T[],
  ids: string[],
  results: PromiseSettledResult<unknown>[],
): { rows: T[]; succeeded: string[]; failed: string[] } {
  const succeeded = new Set(ids.filter((_, i) => results[i]?.status === 'fulfilled'))
  return {
    rows: rows.filter((r) => !succeeded.has(r.id)),
    succeeded: ids.filter((id) => succeeded.has(id)),
    failed: ids.filter((id) => !succeeded.has(id)),
  }
}

export default function StudentsClient({
  auth0Id,
  initialStudents,
  sports,
  teams,
  canManage,
  canInvite,
  rosterFailed = false,
}: {
  auth0Id: string
  initialStudents: Student[]
  sports: string[]
  teams: { id: string; name: string }[]
  /** Roster writes (create/edit/delete/import/bulk status) — player.manage. */
  canManage: boolean
  /** Player-signup invites — pinned to the email-route floor. */
  canInvite: boolean
  /**
   * The server's roster read rejected, so `initialStudents` is empty because nothing
   * arrived — not because the club has no players. Without this the empty state below
   * told a coach with thirty players to "Add your first student", which is a false
   * claim AND invites a duplicate row. Defaults false so every other caller (and the
   * a11y render sweep, which has no server read) keeps the plain empty semantics.
   */
  rosterFailed?: boolean
}) {
  const [students, setStudents] = useState<Student[]>(initialStudents)
  // Seeded from the prop, then owned locally: `refreshStudents` re-runs the same
  // roster read, so a success has to clear the flag or the failure banner would keep
  // sitting over a roster that has since loaded.
  const [rosterReadFailed, setRosterReadFailed] = useState(rosterFailed)
  const [search, setSearch] = useState('')
  const [sport, setSport] = useState('')
  const [status, setStatus] = useState('')
  const [teamId, setTeamId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deleting, setDeleting] = useState<Student | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // `refreshStudents` and the import dialog both re-read the roster without disabling
  // each other, so an earlier response could land last. Same rule as the debounced
  // searches: only the newest roster read may answer.
  const rosterSeq = useRef(0)
const [showArchived, setShowArchived] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForBulk, setInviteForBulk] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter((s) => {
      if (q && !`${s.full_name} ${s.email ?? ''} ${s.sport ?? ''}`.toLowerCase().includes(q))
        return false
      if (sport && s.sport !== sport) return false
      if (status && s.status !== status) return false
      if (teamId && (s.team_id ?? '') !== teamId) return false
      return true
    })
  }, [students, search, sport, status, teamId])

  const selectedIds = filtered.filter((s) => selected.has(s.id)).map((s) => s.id)
  const allFilteredSelected = filtered.length > 0 && selectedIds.length === filtered.length

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((s) => next.delete(s.id))
      else filtered.forEach((s) => next.add(s.id))
      return next
    })
  }

  const applyBulkStatus = async (nextStatus: Student['status']) => {
    if (!selectedIds.length) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => orgUpdateStudent(auth0Id, id, { status: nextStatus })),
      )
      // Only the ids whose write FULFILLED may change locally: rewriting every selected
      // row regardless of outcome made the roster claim a change the server rejected,
      // while the toast reported the `ok` count. The set is built from `results` in the
      // SAME order as `selectedIds`, which is what pairs a result with its id.
      const { rows, succeeded, failed } = applyBulkStatusResult(
        students,
        selectedIds,
        results,
        nextStatus,
      )
      const ok = succeeded.length
      setStudents(rows)
      if (ok > 0) toast.success(`Updated ${ok} student(s) to ${nextStatus}`)
      if (ok < selectedIds.length)
        toast.error(
          `${selectedIds.length - ok} student(s) could not be updated — still showing their previous status`,
        )
      // Prune rather than clear: a row whose write failed stays selected, so the coach can
      // retry it. Clearing was part of the same lie — the failed subset became
      // unrecoverable without re-selecting by hand.
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of failed) next.add(id)
        return next
      })
    } finally {
      setBulkBusy(false)
    }
  }

  const confirmBulkDelete = async () => {
    if (!selectedIds.length) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => orgDeleteStudent(auth0Id, id)),
      )
      // Only the ids whose delete FULFILLED leave the roster.
      //
      // This filtered out `selected.has(p.id)` wholesale, so a partial failure made every
      // row vanish from the view while the toast — which used the `ok` count — reported
      // "Removed 18 · 2 could not be removed". The two that survived still had their
      // attendance, objectives and plans, and because the selection was then cleared they
      // were unrecoverable from the UI: the coach could not see them, select them, or
      // retry. In a product with erasure and data-rights surfaces, a false "removed" is a
      // wrong belief about persisted data, not a cosmetic one.
      //
      // `selected.has(p.id)` was also the wrong SET: `selected` survives a filter change,
      // while `selectedIds` is derived from the filtered list — so this rewrote rows that
      // were never part of the request at all.
      const { rows, succeeded, failed } = applyBulkDeleteResult(students, selectedIds, results)
      const ok = succeeded.length
      setStudents(rows)
      if (ok > 0) toast.success(`Removed ${ok} student(s)`)
      if (ok < selectedIds.length)
        toast.error(
          `${selectedIds.length - ok} student(s) could not be removed — still on the roster`,
        )
      // As above: a row that survived stays selected so the retry is one click.
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of failed) next.add(id)
        return next
      })
    } finally {
      setBulkBusy(false)
    }
  }

  const exportCSV = () => {
    // The LOCAL day, not `toISOString()`'s UTC day: east of UTC just after midnight the
    // export would otherwise be named for YESTERDAY, west of UTC in the evening for
    // TOMORROW. Same rule as every other day in this app — the day the viewer is on.
    downloadCSV(`roster-${toISODate(new Date())}.csv`, [
      [
        'Full name',
        'Email',
        'Phone',
        'Sport',
        'Position',
        'Jersey #',
        'Status',
        'Joined',
        'Date of birth',
        'Gender',
        'Guardian name',
        'Guardian phone',
        'Notes',
      ],
      ...filtered.map((s) => [
        s.full_name,
        s.email,
        s.phone,
        s.sport,
        s.position,
        s.jersey_number,
        s.status,
        s.joined_on,
        s.date_of_birth,
        s.gender,
        s.guardian_name,
        s.guardian_phone,
        s.notes,
      ]),
    ])
  }

  const openCreate = () => {
    setEditingStudent(null)
    setDialogOpen(true)
  }

  const openEdit = (s: Student) => {
    setEditingStudent(s)
    setDialogOpen(true)
  }

  const selectedStudents = filtered.filter((s) => selected.has(s.id))
  const openInvite = (fromBulk: boolean) => {
    setInviteForBulk(fromBulk)
    setInviteOpen(true)
  }

  const onCreated = (s: Student) => {
    setStudents((prev) => [s, ...prev])
  }

  const onUpdated = (s: Student) => {
    setStudents((prev) => prev.map((p) => (p.id === s.id ? s : p)))
  }

  const refreshStudents = async () => {
    const my = ++rosterSeq.current
    const res = await orgStudents(auth0Id, { includeArchived: showArchived })
    if (rosterSeq.current !== my) return
    setStudents(res.students)
    setRosterReadFailed(false)
  }

  const toggleArchived = async () => {
    const next = !showArchived
    setShowArchived(next)
    const my = ++rosterSeq.current
    try {
      const res = await orgStudents(auth0Id, { includeArchived: next })
      if (rosterSeq.current !== my) return
      setStudents(res.students)
      setRosterReadFailed(false)
    } catch {
      if (rosterSeq.current !== my) return
      setShowArchived(!next)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await orgDeleteStudent(auth0Id, deleting.id)
      setStudents((prev) => prev.filter((p) => p.id !== deleting.id))
      toast.success(`${deleting.full_name} removed`)
      setDeleting(null)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to delete student')
    } finally {
      setDeleteBusy(false)
    }
  }

  const sportsForForm = sports.length
    ? sports
    : ['Academy', 'Tennis', 'Cricket', 'Football', 'Basketball']

  return (
    <div>
      <StudentsFilters
        search={search}
        onSearchChange={setSearch}
        sport={sport}
        onSportChange={setSport}
        status={status}
        onStatusChange={setStatus}
        teamId={teamId}
        onTeamChange={setTeamId}
        sportsForForm={sportsForForm}
        teams={teams}
        filteredLength={filtered.length}
        showArchived={showArchived}
        onToggleArchived={toggleArchived}
        onExport={exportCSV}
        canInvite={canInvite}
        onInvite={() => openInvite(false)}
        canManage={canManage}
        onImport={() => setImportOpen(true)}
        onCreate={openCreate}
      />

      <StudentsBulkActions
        selectedCount={selectedIds.length}
        canManage={canManage}
        canInvite={canInvite}
        bulkBusy={bulkBusy}
        onMarkActive={() => applyBulkStatus('active')}
        onMarkInactive={() => applyBulkStatus('inactive')}
        onMarkTransferred={() => applyBulkStatus('transferred')}
        onInvite={() => openInvite(true)}
        onDelete={() => {
          if (
            window.confirm(
              `Remove ${selectedIds.length} selected student(s)? This cannot be undone.`,
            )
          ) {
            confirmBulkDelete()
          }
        }}
        onClear={() => setSelected(new Set())}
      />

      <StudentsTable
        students={students}
        filtered={filtered}
        selected={selected}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        allFilteredSelected={allFilteredSelected}
        selectedIds={selectedIds}
        onEdit={openEdit}
        onDelete={setDeleting}
        canManage={canManage}
        teams={teams}
        rosterReadFailed={rosterReadFailed}
        onCreate={openCreate}
      />

      {/* Create / edit dialog (keyed so the form resets per student) */}
      <StudentFormDialog
        key={editingStudent?.id ?? 'new'}
        auth0Id={auth0Id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        student={editingStudent}
        sports={sports}
        teams={teams}
        onCreated={onCreated}
        onUpdated={onUpdated}
      />

      {/* Delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.full_name}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the student and their attendance records. Past reports
              keep a snapshot. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner /> : 'Delete student'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite players */}
      <InvitePlayersDialog
        auth0Id={auth0Id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        selectedEmails={
          inviteForBulk
            ? selectedStudents.map((s) => s.email).filter((e): e is string => Boolean(e))
            : undefined
        }
        selectedStudentIds={inviteForBulk ? selectedStudents.map((s) => s.id) : undefined}
      />

      {/* Import students */}
      <StudentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        auth0Id={auth0Id}
        onImported={async () => {
          // Awaited, and the toast fires AFTER. This called `refreshStudents()` bare —
          // no `await`, no `.catch`, promise discarded — and then reported success. So a
          // failed roster refresh was an unhandled rejection with a success toast already
          // on screen: the coach was told the import landed while the imported players
          // never appeared, and nothing said otherwise. The message now describes work
          // that has actually completed.
          try {
            await refreshStudents()
            toast.success('Roster updated')
          } catch {
            // The import DID land server-side; only the list refresh failed. Saying so is
            // the honest outcome — a bare "failed" would wrongly suggest the upload was
            // lost, and re-uploading would duplicate rows.
            toast.error(
              'Players were imported, but the roster could not be refreshed. Reload to see them.',
            )
          }
        }}
      />
    </div>
  )
}
