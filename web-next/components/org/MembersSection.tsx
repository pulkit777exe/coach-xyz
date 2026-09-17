"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { Badge } from "@/components/9ui/ui/badge"
import { Button } from "@/components/9ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/9ui/ui/dialog"
import { Input } from "@/components/9ui/ui/input"
import { Label } from "@/components/9ui/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/9ui/ui/select"
import { Spinner } from "./Spinner"

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
} from "@/lib/members"
import type { CoachAIError } from "@/lib/api"

// role → label map for the base-ui Select `items` prop (renders the current
// value's label inside the trigger).
const ROLE_ITEMS: Record<string, string> = Object.fromEntries(
  ORG_MEMBER_ROLES.map((r) => [r, ORG_MEMBER_ROLE_LABELS[r]]),
)
const INVITE_ROLE_ITEMS: Record<string, string> = Object.fromEntries(
  ORG_MEMBER_INVITE_ROLES.map((r) => [r, ORG_MEMBER_ROLE_LABELS[r]]),
)

const ROLE_BADGE_VARIANT: Record<
  OrgMemberRole,
  "default" | "secondary" | "success" | "info"
> = {
  owner: "default",
  admin: "info",
  coach: "success",
  player: "secondary",
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  return parts[0].substring(0, 2).toUpperCase()
}

function messageOf(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as CoachAIError).message === "string") {
    return (err as CoachAIError).message
  }
  return fallback
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
        setError(messageOf(err, "Failed to load staff"))
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
  const canInvite = currentUserRole === "owner" || currentUserRole === "admin"
  const canManageRoles = currentUserRole === "owner"
  const members = data?.members ?? []
  const owner = members.find((m) => m.role === "owner")
  const ownerCount = members.filter((m) => m.role === "owner").length

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
      toast.error(messageOf(err, "Failed to update role"))
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async () => {
    if (!pendingRemove) return
    setBusyId(pendingRemove.id)
    try {
      await orgRemoveMember(auth0Id, pendingRemove.id)
      setData((prev) => {
        if (!prev) return prev
        return { ...prev, members: prev.members.filter((m) => m.id !== pendingRemove.id) }
      })
      toast.success(`${pendingRemove.display_name ?? pendingRemove.member_email ?? "Member"} removed`)
      setPendingRemove(null)
    } catch (err) {
      toast.error(messageOf(err, "Failed to remove member"))
    } finally {
      setBusyId(null)
    }
  }

  const ownerRowCannotBeRemoved = (member: OrgMember): boolean =>
    member.role === "owner" && ownerCount <= 1

  return (
    <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Staff
        </p>
        {canInvite && (
          <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
            <PlusIcon />
            Invite member
          </Button>
        )}
      </div>

      {error ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {error}
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center px-6 py-10">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          No staff on the team yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((member) => {
            const name = member.display_name ?? member.member_email ?? "No name"
            const isOwner = member.role === "owner"
            return (
              <li key={member.id} className="flex items-center gap-4 px-6 py-3.5">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                  {name === "No name" ? "?" : initials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{name}</p>
                  {member.member_email && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.member_email}</p>
                  )}
                </div>
                <Badge variant={ROLE_BADGE_VARIANT[member.role]}>
                  {ORG_MEMBER_ROLE_LABELS[member.role]}
                </Badge>
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
                          {ORG_MEMBER_ROLES.filter((r) => r !== "owner").map((r) => (
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
                        onClick={() => setPendingRemove(member)}
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
        <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          Staff with a Coach or Admin role gain access to this organization when they
          sign in with their email. {canManageRoles ? "Only the owner" : "The owner"} can
          change roles or remove staff.
        </p>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <InviteMemberForm auth0Id={auth0Id} onInvited={refresh} onClose={() => setInviteOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingRemove)} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Remove {pendingRemove?.display_name ?? pendingRemove?.member_email ?? "member"}?
            </DialogTitle>
            <DialogDescription>
              This revokes their access to this organization&apos;s data. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={busyId !== null}>
              {busyId === pendingRemove?.id ? <Spinner /> : "Remove"}
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
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>(ORG_MEMBER_INVITE_ROLES[1])
  const [busy, setBusy] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())

  const submit = async () => {
    if (!emailValid) return
    setBusy(true)
    try {
      await orgInviteMember(auth0Id, { email: email.trim(), role: role as OrgMemberInviteRole })
      toast.success("Staff member invited")
      onInvited()
      setEmail("")
      onClose()
    } catch (err) {
      toast.error(messageOf(err, "Failed to invite member"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite staff</DialogTitle>
        <DialogDescription>
          Invite a Coach or Admin by email. They gain access to this organization
          when they sign in with that email.
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
              if (typeof value === "string" && value) setRole(value)
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
          {busy ? <Spinner /> : "Send invite"}
        </Button>
      </DialogFooter>
    </>
  )
}