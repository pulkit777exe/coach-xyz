'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Spinner } from './Spinner'
import StatusPill, { type StatusTone } from './StatusPill'

import {
  ORG_MEMBER_INVITE_ROLES,
  ORG_MEMBER_ROLES,
  ORG_MEMBER_ROLE_LABELS,
  orgInviteMember,
  orgMembers,
  orgRemoveMember,
  orgSetMemberRole,
  type OrgMember,
  type OrgMemberInviteRole,
  type OrgMemberRole,
  type OrgMembersResponse,
} from '@/lib/members'
import { initials } from '@/lib/initials'
import { errorMessageOf } from '@/lib/errors'
import { EMAIL_RE } from '@/lib/email'

// role → label map for the base-ui Select `items` prop (renders the current
// value's label inside the trigger).
const ROLE_ITEMS: Record<string, string> = Object.fromEntries(
  ORG_MEMBER_ROLES.map((r) => [r, ORG_MEMBER_ROLE_LABELS[r]]),
)
const INVITE_ROLE_ITEMS: Record<string, string> = Object.fromEntries(
  ORG_MEMBER_INVITE_ROLES.map((r) => [r, ORG_MEMBER_ROLE_LABELS[r]]),
)

const ROLE_TONE: Record<OrgMemberRole, StatusTone> = {
  owner: 'primary',
  head_coach: 'green',
  junior_coach: 'blue',
  player: 'gray',
}

export default function MembersSection({
  auth0Id,
  initialData = null,
}: {
  auth0Id: string
  initialData?: OrgMembersResponse | null
}) {
  const [data, setData] = useState<OrgMembersResponse | null>(initialData)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(initialData === null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null)
  const [pendingSuccessor, setPendingSuccessor] = useState<string>('custodian')
  const requestSeq = useRef(0)
  const mountedRef = useRef(initialData !== null)

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current
    try {
      const res = await orgMembers(auth0Id)
      if (requestSeq.current === seq) {
        setData(res)
        setError(null)
      }
    } catch (err) {
      if (requestSeq.current === seq) {
        setError(errorMessageOf(err, 'Failed to load staff'))
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false)
    }
  }, [auth0Id])

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    void refresh()
  }, [refresh])

  const currentUserRole = data?.current_user_role ?? null
  const canInvite = currentUserRole === 'owner' || currentUserRole === 'head_coach'
  const canManageRoles = currentUserRole === 'owner'
  const members = data?.members ?? []
  const owner = members.find((m) => m.role === 'owner')
  const ownerCount = members.filter((m) => m.role === 'owner').length

  const handleRoleChange = async (member: OrgMember, rawRole: string | null) => {
    if (!rawRole || rawRole === member.role) return
    setBusyId(member.id)
    try {
      const res = await orgSetMemberRole(auth0Id, member.id, rawRole as OrgMemberRole)
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          members: prev.members.map((m) => (m.id === member.id ? res.member : m)),
        }
      })
    } catch (err) {
      toast.error(errorMessageOf(err, 'Failed to update role'))
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async () => {
    if (!pendingRemove) return
    setBusyId(pendingRemove.id)
    try {
      const res = await orgRemoveMember(
        auth0Id,
        pendingRemove.id,
        pendingSuccessor === 'custodian' ? undefined : pendingSuccessor,
      )
      setData((prev) => {
        if (!prev) return prev
        return { ...prev, members: prev.members.filter((m) => m.id !== pendingRemove.id) }
      })
      toast.success(
        `${pendingRemove.display_name ?? pendingRemove.member_email ?? 'Member'} removed${
          res.successor ? ' — teams transferred' : ''
        }`,
      )
      setPendingRemove(null)
    } catch (err) {
      toast.error(errorMessageOf(err, 'Failed to remove member'))
    } finally {
      setBusyId(null)
    }
  }

  const openRemove = (member: OrgMember) => {
    setPendingSuccessor('custodian')
    setPendingRemove(member)
  }

  // Successor candidates: roles holding team.manage_members, minus the leaver.
  // Anything else is refused server-side (422); the custodian default keeps
  // the common case one click.
  const successorCandidates = members.filter(
    (m) =>
      pendingRemove !== null &&
      m.id !== pendingRemove.id &&
      (m.role === 'owner' || m.role === 'admin' || m.role === 'head_coach' || m.role === 'coach'),
  )

  const ownerRowCannotBeRemoved = (member: OrgMember): boolean =>
    member.role === 'owner' && ownerCount <= 1

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-2.5">
        <h2 className="text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">
          Staff
        </h2>
        {canInvite && (
          <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
            <PlusIcon />
            Invite member
          </Button>
        )}
      </div>

      {error ? (
        <p className="py-8 text-center text-body text-muted-foreground">{error}</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <p className="py-8 text-center text-body text-muted-foreground">
          No staff on the team yet.
        </p>
      ) : (
        <ul>
          {members.map((member) => {
            const name = member.display_name ?? member.member_email ?? 'No name'
            const isOwner = member.role === 'owner'
            return (
              <li
                key={member.id}
                className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground">
                  {name === 'No name' ? '?' : initials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium leading-[1.4] text-foreground">
                    {name}
                  </p>
                  {member.member_email && (
                    <p className="mt-0.5 truncate text-meta text-muted-foreground">
                      {member.member_email}
                    </p>
                  )}
                </div>
                <StatusPill tone={ROLE_TONE[member.role]}>
                  {ORG_MEMBER_ROLE_LABELS[member.role]}
                </StatusPill>
                {busyId === member.id ? (
                  <Spinner className="shrink-0 text-muted-foreground" />
                ) : (
                  <>
                    {!isOwner && canManageRoles && (
                      <Select
                        items={ROLE_ITEMS}
                        value={member.role}
                        onValueChange={(value) => {
                          void handleRoleChange(member, value as string | null)
                        }}
                      >
                        <SelectTrigger size="sm" aria-label={`Change role for ${name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ORG_MEMBER_ROLES.filter((r) => r !== 'owner').map((r) => (
                            <SelectItem key={r} value={r}>
                              {ORG_MEMBER_ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!isOwner && canManageRoles && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${name}`}
                        disabled={ownerRowCannotBeRemoved(member)}
                        onClick={() => openRemove(member)}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {owner && (
        <p className="border-t border-border pt-3 text-meta text-muted-foreground">
          Staff with a Coach or Admin role gain access to this organization when they sign in with
          their email. {canManageRoles ? 'Only the owner' : 'The owner'} can change roles or remove
          staff.
        </p>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <InviteMemberForm
            auth0Id={auth0Id}
            onInvited={refresh}
            onClose={() => setInviteOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Remove {pendingRemove?.display_name ?? pendingRemove?.member_email ?? 'member'}?
            </DialogTitle>
            <DialogDescription>
              This revokes their access to this organization&apos;s data. Their teams go to the
              successor below, or back to the owner when no successor is named. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="remove_successor">Successor for their teams</Label>
            <Select
              id="remove_successor"
              items={{
                custodian: 'Owner (custodian)',
                ...Object.fromEntries(
                  successorCandidates.map((m) => [m.id, m.display_name ?? m.member_email ?? m.id]),
                ),
              }}
              value={pendingSuccessor}
              onValueChange={(value) => {
                if (typeof value === 'string' && value) setPendingSuccessor(value)
              }}
            >
              <SelectTrigger aria-label="Successor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custodian">Owner (custodian)</SelectItem>
                {successorCandidates.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.display_name ?? m.member_email ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={busyId !== null}>
              {busyId === pendingRemove?.id ? <Spinner /> : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InviteMemberForm({
  auth0Id,
  onInvited,
  onClose,
}: {
  auth0Id: string
  onInvited: () => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>(ORG_MEMBER_INVITE_ROLES[1])
  const [busy, setBusy] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())

  const submit = async () => {
    if (!emailValid) return
    setBusy(true)
    try {
      await orgInviteMember(auth0Id, { email: email.trim(), role: role as OrgMemberInviteRole })
      toast.success('Staff member invited')
      onInvited()
      setEmail('')
      onClose()
    } catch (err) {
      toast.error(errorMessageOf(err, 'Failed to invite member'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite staff</DialogTitle>
        <DialogDescription>
          Invite a Coach or Admin by email. They gain access to this organization when they sign in
          with that email.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="invite_staff_email">Email address</Label>
          <Input
            id="invite_staff_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="coach@club.com"
            autoComplete="email"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite_staff_role">Role</Label>
          <Select
            id="invite_staff_role"
            items={INVITE_ROLE_ITEMS}
            value={role}
            onValueChange={(value) => {
              if (typeof value === 'string' && value) setRole(value)
            }}
          >
            <SelectTrigger aria-label="Role">
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
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !emailValid}>
          {busy ? <Spinner /> : 'Send invite'}
        </Button>
      </DialogFooter>
    </>
  )
}
