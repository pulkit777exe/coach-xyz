'use client'

import { CalendarIcon, MailIcon, MoreHorizontalIcon, PencilIcon, PhoneIcon, TrashIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/9ui/ui/avatar'
import { Button } from '@/components/9ui/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/9ui/ui/dropdown-menu'
import { initials } from '@/lib/initials'
import { formatDateLong } from '@/lib/date'
import type { Student } from '@/lib/org/types'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/15 text-success',
  inactive: 'bg-warning/15 text-warning',
  transferred: 'bg-muted text-muted-foreground',
}

export function StudentProfileHeader({
  student,
  canWrite,
  onEdit,
  onDelete,
}: {
  student: Student
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-5 rounded-[6px] border p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Avatar className="border-border size-16 border">
          <AvatarImage src={undefined} alt="" />
          <AvatarFallback className="bg-muted text-muted-foreground font-semibold text-lg">
            {initials(student.full_name)}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground">
              {student.full_name}
            </h2>
            <span
              className={`inline-flex h-[20px] items-center rounded-full px-2 font-medium leading-none text-label ${STATUS_STYLE[student.status] ?? 'bg-muted text-muted-foreground'}`}
            >
              {student.status}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
            {student.sport && <span>{student.sport}</span>}
            {student.position && <span>{student.position}</span>}
            {student.jersey_number === null || student.jersey_number === undefined ? null : (
              <span>#{student.jersey_number}</span>
            )}
            {student.gender && <span className="capitalize">{student.gender}</span>}
          </div>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta">
            {student.email && (
              <span className="flex items-center gap-1.5">
                <MailIcon className="size-3" /> {student.email}
              </span>
            )}
            {student.phone && (
              <span className="flex items-center gap-1.5">
                <PhoneIcon className="size-3" /> {student.phone}
              </span>
            )}
            {student.joined_on && (
              <span className="flex items-center gap-1.5">
                <CalendarIcon className="size-3" /> Joined {formatDateLong(student.joined_on)}
              </span>
            )}
          </div>
        </div>
      </div>

      {canWrite && (
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
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon className="size-3.5" />
              Edit profile
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <TrashIcon className="size-3.5" />
              Delete student
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export default StudentProfileHeader
