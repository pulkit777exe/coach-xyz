'use client'

import { useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import Section from '@/components/org/Section'
import StatusPill from '@/components/org/StatusPill'
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
import { formatDateNumeric } from '@/lib/date'
import { EMAIL_RE } from '@/lib/email'
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
  /**
   * The page's own read of the invite list failed. Same convention as `TeamsClient`'s
   * `teamsFailed`: the page must resolve `null` rather than substituting `[]`, because
   * an empty list here is indistinguishable from "this org has no invitations".
   */
  invitesFailed?: boolean
  /** May issue + revoke invitations (server floors: owner/admin only). */
  canInvite: boolean
}

export default function InvitesClient({
  auth0Id,
  initialInvites,
  invitesFailed = false,
  canInvite,
}: InvitesClientProps) {
  const [invites, setInvites] = useState<OrgInvite[]>(initialInvites)
  // Every read reports its own outcome. A failed read must never render as "no
  // invitations": the header counts this org's outstanding invitations, so a broken
  // read showed an org with four outstanding invites as "0 pending." and "No
  // invitations yet." — a fabricated count, not a missing one.
  const [readFailed, setReadFailed] = useState(invitesFailed)
  // Separate from the dialog's `error`: a revoke happens with the dialog closed, so its
  // failure reported there would be rendered nowhere at all.
  const [listError, setListError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('junior_coach')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  /** Returns whether the refresh succeeded, so callers can report a failed read. */
  const refresh = async (): Promise<boolean> => {
    try {
      const res = await orgInvites(auth0Id)
      setInvites(res.invites)
      setReadFailed(false)
      return true
    } catch {
      // This had no `.catch` at all, so a refresh that failed after a successful write
      // became an unhandled rejection: the invite stayed on screen as pending, with a
      // live Revoke button and nothing anywhere explaining why.
      setReadFailed(true)
      return false
    }
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
      // The invitation WAS created. Whether the list can then be re-read is a separate
      // question, and reporting the mint as failed because a later read broke would be
      // its own false claim.
      if (!(await refresh())) {
        setError('Invitation created, but the list could not be refreshed — reload the page.')
      }
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
    <Section
      title="Invitations"
      actions={
        canInvite ? (
          <Button
            size="sm"
            onClick={() => {
              setLastToken(null)
              setError(null)
              setOpen(true)
            }}
          >
            New invitation
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-meta leading-[1.5] text-muted-foreground">
        Single-use links, valid 7 days.{' '}
        {/* A number here is a claim about this org's outstanding invitations. When the
            read failed there is no claim to make, so say that rather than summarising an
            empty list into a confident "0 pending." */}
        {readFailed ? (
          'Pending count unavailable.'
        ) : (
          <>
            <span className="tabular-nums">{pending.length}</span> pending.
          </>
        )}
      </p>
      <div className="space-y-2">
        {listError && <p className="text-body leading-5 text-destructive">{listError}</p>}
        {lastToken && inviteLink && (
          <div className="rounded-[6px] border border-primary/30 bg-primary/5 p-3">
            <p className="mb-1 text-meta font-medium text-foreground">
              Share this link (shown once)
            </p>
            <p className="break-all text-meta text-muted-foreground">{inviteLink}</p>
            <Button size="sm" variant="outline" className="mt-2 h-7" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        )}
        {readFailed ? (
          // Wording covers both cases the flag can be set in: a first read that never
          // landed (so the list below really is empty) and a refresh that failed with
          // rows from an earlier successful read still on screen.
          <p className="text-body text-muted-foreground">
            Invitations could not be read. This is a loading problem, not an empty list — reload
            the page.
          </p>
        ) : (
          invites.length === 0 && (
            <p className="text-body text-muted-foreground">No invitations yet.</p>
          )
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
              className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium leading-[1.4] text-foreground">
                  {invite.email}
                </p>
                <p className="text-meta text-muted-foreground">
                  Expires {formatDateNumeric(invite.expires_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone="gray">
                  {ORG_MEMBER_ROLE_LABELS[invite.role] ?? invite.role}
                </StatusPill>
                <StatusPill
                  tone={state === 'pending' ? 'amber' : state === 'accepted' ? 'primary' : 'gray'}
                >
                  {state}
                </StatusPill>
                {state === 'pending' && canInvite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setListError(null)
                      try {
                        await orgRevokeInvite(auth0Id, invite.id)
                        // The revoke succeeded. A refresh that then failed is a different
                        // problem from a revoke that failed, and saying the invitation
                        // could not be revoked after it was would be its own false claim.
                        if (!(await refresh())) {
                          setListError(
                            'Invitation revoked, but the list could not be refreshed — reload to confirm.',
                          )
                        }
                      } catch (e) {
                        setListError(
                          e instanceof Error ? e.message : 'Could not revoke invitation.',
                        )
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
      </div>

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
            {error && <p className="text-body leading-5 text-destructive">{error}</p>}
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
    </Section>
  )
}
