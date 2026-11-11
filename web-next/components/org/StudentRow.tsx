'use client'

import Link from 'next/link'
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import { Checkbox } from '@/components/9ui/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/9ui/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/9ui/ui/dropdown-menu'
import StatusPill from '@/components/org/StatusPill'
import { initials } from '@/lib/initials'
import { formatDateMed } from '@/lib/date'
import type { Student } from '@/lib/org/types'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/15 text-success',
  inactive: 'bg-warning/15 text-warning',
  transferred: 'bg-muted text-muted-foreground',
}

export function StudentRow({
  student,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  canManage,
  teams,
}: {
  student: Student
  selected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (s: Student) => void
  onDelete: (s: Student) => void
  canManage: boolean
  teams: { id: string; name: string }[]
}) {
  const team = teams.find((t) => t.id === student.team_id)

  return (
    <tr
      className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-accent/50 [content-visibility:auto] [contain-intrinsic-size:auto_56px]"
    >
      <td className="px-4 py-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(student.id)}
          aria-label={`Select ${student.full_name}`}
        />
      </td>
      <td className="px-4 py-2.5">
        <Link href={`/dashboard/students/${student.id}`} className="flex items-center gap-3">
          <Avatar className="border-border size-9 border">
            <AvatarImage src={undefined} alt="" />
            <AvatarFallback className="bg-muted text-muted-foreground text-caption">
              {initials(student.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{student.full_name}</p>
            <p className="truncate text-meta text-muted-foreground">
              {student.email || student.phone || '—'}
            </p>
            {student.account_auth0_id && (
              <p className="mt-0.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                • linked to player account
              </p>
            )}
          </div>
        </Link>
      </td>
      <td className="px-4 py-2.5">
        {student.sport ? (
          <StatusPill tone="gray">{student.sport}</StatusPill>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {student.jersey_number ? (
          <span className="ml-1 text-meta tabular-nums text-muted-foreground">
            #{student.jersey_number}
          </span>
        ) : null}
      </td>
      <td className="hidden px-4 py-2.5 md:table-cell">
        {team ? (
          <StatusPill tone="gray">{team.name}</StatusPill>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
        {student.position || '—'}
      </td>
      <td className="hidden px-4 py-2.5 text-muted-foreground tabular-nums md:table-cell">
        {student.joined_on ? formatDateMed(student.joined_on) : '—'}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex h-[20px] items-center rounded-full px-2 font-medium leading-none text-label ${STATUS_STYLE[student.status] ?? 'bg-muted text-muted-foreground'}`}
        >
          {student.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${student.full_name}`}
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <Link href={`/dashboard/students/${student.id}`}>
                    <span className="flex items-center gap-2">
                      <MoreHorizontalIcon className="size-3.5" />
                      View profile
                    </span>
                  </Link>
                }
              />
              <DropdownMenuItem onClick={() => onEdit(student)}>
                <PencilIcon className="size-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(student)}>
                <TrashIcon className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  )
}

export default StudentRow
