'use client'

import { Checkbox } from '@/components/9ui/ui/checkbox'
import StudentRow from '@/components/org/StudentRow'
import EmptyState from '@/components/org/EmptyState'
import { Button } from '@/components/9ui/ui/button'
import { PlusIcon } from 'lucide-react'
import type { Student } from '@/lib/org/types'

export function StudentsTable({
  students,
  filtered,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  allFilteredSelected,
  selectedIds,
  onEdit,
  onDelete,
  canManage,
  teams,
  rosterReadFailed,
  onCreate,
}: {
  students: Student[]
  filtered: Student[]
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  allFilteredSelected: boolean
  selectedIds: string[]
  onEdit: (s: Student) => void
  onDelete: (s: Student) => void
  canManage: boolean
  teams: { id: string; name: string }[]
  rosterReadFailed: boolean
  onCreate: () => void
}) {
  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-card">
      {rosterReadFailed ? (
        <EmptyState
          title="Roster failed to load."
          description="This is a loading problem, not an empty roster — reload the page to try again."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={students.length === 0 ? 'No students yet' : 'No matching students'}
          description={
            students.length === 0
              ? 'Add your first student to get started.'
              : 'Try clearing your search or filters.'
          }
          action={
            students.length === 0 && canManage ? (
              <Button size="sm" onClick={onCreate}>
                <PlusIcon />
                Add student
              </Button>
            ) : undefined
          }
        />
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2.5">
                <Checkbox
                  checked={allFilteredSelected}
                  indeterminate={selectedIds.length > 0 && !allFilteredSelected}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Select all students"
                />
              </th>
              <th className="px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Student
              </th>
              <th className="px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Sport
              </th>
              <th className="hidden px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                Team
              </th>
              <th className="hidden px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                Position
              </th>
              <th className="hidden px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                Joined
              </th>
              <th className="px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2.5 text-right text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <StudentRow
                key={s.id}
                student={s}
                selected={selected.has(s.id)}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                canManage={canManage}
                teams={teams}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default StudentsTable
