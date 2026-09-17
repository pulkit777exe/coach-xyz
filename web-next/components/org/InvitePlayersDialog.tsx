"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/9ui/ui/button"
import { Label } from "@/components/9ui/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/9ui/ui/dialog"
import { Spinner } from "./Spinner"

import { orgSendInvites } from "@/lib/org"
import type { CoachAIError } from "@/lib/api"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmails(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(parts.filter((e) => EMAIL_RE.test(e)))]
}

export default function InvitePlayersDialog({
  auth0Id,
  open,
  onOpenChange,
  selectedEmails,
  selectedStudentIds,
}: {
  auth0Id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedEmails?: string[]
  selectedStudentIds?: string[]
}) {
  const [raw, setRaw] = useState("")
  const [busy, setBusy] = useState(false)

  const prefilled =
    selectedEmails && selectedEmails.length > 0 ? selectedEmails.join("\n") : ""
  const display = raw || prefilled

  const emails = parseEmails(display)

  const handleSend = async () => {
    if (!emails.length) return
    setBusy(true)
    try {
      const res = await orgSendInvites(auth0Id, {
        emails,
        student_ids: selectedStudentIds ?? [],
      })
      if (res.failed > 0) {
        toast.success(`Invited ${res.total - res.failed} of ${res.total} player(s)`)
      } else {
        toast.success(`Invited ${res.total} player(s)`)
      }
      setRaw("")
      onOpenChange(false)
    } catch (err) {
      const e = err as CoachAIError
      if (e.code === "EMAIL_NOT_CONFIGURED") {
        toast.error("Email sending is not configured on the server.")
      } else {
        toast.error(e.message ?? "Failed to send invites")
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
          setRaw("")
          setBusy(false)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite players</DialogTitle>
          <DialogDescription>
            Enter email addresses below. Players will sign up via Auth0 and
            automatically link to the roster by email.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite_emails">Email addresses</Label>
            <textarea
              id="invite_emails"
              value={display}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"one@email.com\ntwo@email.com"}
              rows={5}
              className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:border-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
            {emails.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {emails.length} valid email{emails.length !== 1 && "s"} detected
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={busy || emails.length === 0}>
            {busy ? <Spinner /> : "Send invites"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
