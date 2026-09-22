'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Spinner } from './Spinner'

import { orgEmailAttendance } from '@/lib/org'
import type { CoachAIError } from '@/lib/api'

export default function EmailAttendanceDialog({
  auth0Id,
  open,
  onOpenChange,
  from,
  to,
}: {
  auth0Id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  from?: string
  to?: string
}) {
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSend = async () => {
    if (!recipient.trim()) return
    setBusy(true)
    try {
      const res = await orgEmailAttendance(auth0Id, {
        from,
        to,
        recipient: recipient.trim(),
      })
      if (res.records === 0) {
        toast.info('No attendance records in the selected range')
      } else {
        toast.success(`Attendance emailed to ${recipient.trim()}`)
      }
      setRecipient('')
      onOpenChange(false)
    } catch (err) {
      const e = err as CoachAIError
      if (e.code === 'EMAIL_NOT_CONFIGURED') {
        toast.error('Email sending is not configured on the server.')
      } else {
        toast.error(e.message ?? 'Failed to email attendance')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setRecipient('')
          setBusy(false)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email attendance sheet</DialogTitle>
          <DialogDescription>
            Send the attendance sheet for the selected date range via email.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email_att_recipient">Recipient email</Label>
            <Input
              id="email_att_recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="coach@example.com"
            />
          </div>
          {(from || to) && (
            <div className="grid gap-1.5">
              <Label>Date range</Label>
              <p className="text-muted-foreground bg-muted rounded-md border border-border px-3 py-2 text-sm">
                {from ?? '—'} → {to ?? '—'}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={busy || !recipient.trim()}>
            {busy ? <Spinner /> : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
