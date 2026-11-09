'use client'

import { PlusIcon, SearchIcon, UserPlusIcon, DownloadIcon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS } from '@/lib/org/types'

export function StudentsFilters({
  search,
  onSearchChange,
  sport,
  onSportChange,
  status,
  onStatusChange,
  teamId,
  onTeamChange,
  sportsForForm,
  teams,
  filteredLength,
  showArchived,
  onToggleArchived,
  onExport,
  canInvite,
  onInvite,
  canManage,
  onImport,
  onCreate,
}: {
  search: string
  onSearchChange: (v: string) => void
  sport: string
  onSportChange: (v: string) => void
  status: string
  onStatusChange: (v: string) => void
  teamId: string
  onTeamChange: (v: string) => void
  sportsForForm: string[]
  teams: { id: string; name: string }[]
  filteredLength: number
  showArchived: boolean
  onToggleArchived: () => void
  onExport: () => void
  canInvite: boolean
  onInvite: () => void
  canManage: boolean
  onImport: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 gap-2 flex-col sm:flex-row sm:max-w-md">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, email, sport…"
            aria-label="Search students"
            className="pl-9"
          />
        </div>
        <Select
          items={{ __all: 'All sports', ...Object.fromEntries(sportsForForm.map((s) => [s, s])) }}
          value={sport || '__all'}
          onValueChange={(v) => onSportChange(v === '__all' ? '' : typeof v === 'string' ? v : '')}
        >
          <SelectTrigger aria-label="Filter by sport" className="w-36">
            <SelectValue placeholder="All sports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All sports</SelectItem>
            {sportsForForm.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={{
            __all: 'All statuses',
            ...Object.fromEntries(STUDENT_STATUSES.map((s) => [s, STUDENT_STATUS_LABELS[s]])),
          }}
          value={status || '__all'}
          onValueChange={(v) => onStatusChange(v === '__all' ? '' : typeof v === 'string' ? v : '')}
        >
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All statuses</SelectItem>
            {STUDENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STUDENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={{ __all: 'All teams', ...Object.fromEntries(teams.map((t) => [t.id, t.name])) }}
          value={teamId || '__all'}
          onValueChange={(v) => onTeamChange(v === '__all' ? '' : typeof v === 'string' ? v : '')}
        >
          <SelectTrigger aria-label="Filter by team" className="w-36">
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All teams</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        {filteredLength > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={onToggleArchived}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport}>
              <DownloadIcon /> Export
            </Button>
          </>
        )}
        {canInvite && (
          <Button variant="outline" size="sm" onClick={onInvite}>
            <UserPlusIcon />
            Invite
          </Button>
        )}
        {canManage && (
          <Button variant="outline" size="sm" onClick={onImport}>
            <UploadIcon />
            Import
          </Button>
        )}
        {canManage && (
          <Button size="sm" onClick={onCreate}>
            <PlusIcon />
            Add student
          </Button>
        )}
      </div>
    </div>
  )
}

export default StudentsFilters
