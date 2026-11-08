'use client'

import { MailIcon, TrashIcon } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export function StudentsBulkActions({
  selectedCount,
  canManage,
  canInvite,
  bulkBusy,
  onMarkActive,
  onMarkInactive,
  onMarkTransferred,
  onInvite,
  onDelete,
  onClear,
}: {
  selectedCount: number
  canManage: boolean
  canInvite: boolean
  bulkBusy: boolean
  onMarkActive: () => void
  onMarkInactive: () => void
  onMarkTransferred: () => void
  onInvite: () => void
  onDelete: () => void
  onClear: () => void
}) {
  if (selectedCount === 0) return null

  return (
    <div className="border-border bg-card mb-4 flex flex-wrap items-center gap-2 rounded-[6px] border px-3 py-2">
      <span className="text-meta tabular-nums text-muted-foreground">
        {selectedCount} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={onMarkActive}
            >
              Mark active
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={onMarkInactive}
            >
              Mark inactive
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={bulkBusy}
              onClick={onMarkTransferred}
            >
              Mark transferred
            </Button>
          </>
        )}
        {canInvite && (
          <Button
            variant="outline"
            size="sm"
            disabled={bulkBusy}
            onClick={onInvite}
          >
            <MailIcon /> Invite
          </Button>
        )}
        {canManage && (
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkBusy}
            onClick={onDelete}
          >
            <TrashIcon /> Delete
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={bulkBusy}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </div>
  )
}

export default StudentsBulkActions
