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

import { orgEmailReport } from '@/lib/org'
import type { ReportRecord } from '@/lib/org'
import type { CoachAIError } from '@/types'

export default function EmailReportDialog({
  auth0Id,
  report,
  open,
  onOpenChange,
  defaultEmail,
}: {
  auth0Id: string
  report: ReportRecord
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultEmail?: string
}) {
  const [to, setTo] = useState(defaultEmail ?? '')
  const [busy, setBusy] = useState(false)

  const handleSend = async () => {
    if (!to.trim()) return
    setBusy(true)
    try {
      await orgEmailReport(auth0Id, { report_id: report.id, to: to.trim() })
      toast.success(`Report emailed to ${to.trim()}`)
      setTo('')
      onOpenChange(false)
    } catch (err) {
      const e = err as CoachAIError
      if (e.code === 'EMAIL_NOT_CONFIGURED') {
        toast.error('Email sending is not configured on the server.')
      } else {
        toast.error(e.message ?? 'Failed to email report')
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
          setTo(defaultEmail ?? '')
          setBusy(false)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email report</DialogTitle>
          <DialogDescription>
            Send &ldquo;{report.title}&rdquo; to a recipient via email.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email_report_to">Recipient email</Label>
            <Input
              id="email_report_to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="player@example.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Subject preview</Label>
            <p className="text-muted-foreground bg-muted rounded-[6px] border border-border px-3 py-2 text-meta">
              {report.title}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={busy || !to.trim()}>
            {busy ? <Spinner /> : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
