'use client'

import { useState } from 'react'
import { Badge } from '@/components/9ui/ui/badge'
import { Button } from '@/components/9ui/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/9ui/ui/card'
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
  ORG_MEMBER_INVITE_ROLES,
  ORG_MEMBER_ROLE_LABELS,
  orgInvites,
  orgMintInvite,
  orgRevokeInvite,
  type OrgInvite,
} from '@/lib/members'

interface InvitesClientProps {
  auth0Id: string
  initialInvites: OrgInvite[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function InvitesClient({ auth0Id, initialInvites }: InvitesClientProps) {
  const [invites, setInvites] = useState<OrgInvite[]>(initialInvites)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('assistant_coach')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = async () => {
    const res = await orgInvites(auth0Id)
    setInvites(res.invites)
  }

  const pending = invites.filter(
    (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date(),
  )

  const handleMint = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await orgMintInvite(auth0Id, {
        email: email.trim(),
        role: role as OrgInvite['role'],
      })
      setLastToken(res.token)
      setEmail('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invitation.')
    } finally {
      setBusy(false)
    }
  }

  const inviteLink = lastToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/invite?token=${lastToken}`
    : null

  const copyLink = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable — link stays visible for manual copy
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Invitations</CardTitle>
            <CardDescription>
              Single-use links, valid 7 days. {pending.length} pending.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setLastToken(null)
              setError(null)
              setOpen(true)
            }}
          >
            New invitation
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {lastToken && inviteLink && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-foreground mb-1">
              Share this link (shown once)
            </p>
            <p className="text-xs text-muted-foreground break-all">{inviteLink}</p>
            <Button size="sm" variant="outline" className="mt-2 h-7" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        )}
        {invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        )}
        {invites.map((invite) => {
          const state = invite.accepted_at
            ? 'accepted'
            : invite.revoked_at || new Date(invite.expires_at) <= new Date()
              ? 'expired'
              : 'pending'
          return (
            <div
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{invite.email}</p>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(invite.expires_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {ORG_MEMBER_ROLE_LABELS[invite.role] ?? invite.role}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    state === 'pending'
                      ? 'border-warning/40 text-warning'
                      : state === 'accepted'
                        ? 'border-primary/40 text-primary'
                        : 'text-muted-foreground'
                  }
                >
                  {state}
                </Badge>
                {state === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await orgRevokeInvite(auth0Id, invite.id)
                        await refresh()
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New invitation</DialogTitle>
            <DialogDescription>
              A single-use link valid for 7 days. Shown once — send it to the invitee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="coach@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                items={Object.fromEntries(
                  ORG_MEMBER_INVITE_ROLES.map((r) => [r, ORG_MEMBER_ROLE_LABELS[r]]),
                )}
                value={role}
                onValueChange={(v) => {
                  if (typeof v === 'string') setRole(v)
                }}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_MEMBER_INVITE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ORG_MEMBER_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button disabled={busy} onClick={handleMint}>
              {busy ? 'Creating…' : 'Create invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
