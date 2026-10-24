import { mutateJson, queryJson } from './data/client'
import { orgUrl as coreOrgUrl } from './data/transport'

const org = (auth0Id: string, path: string) => coreOrgUrl(auth0Id, path)

// ── Org-member role vocabulary ──────────────────────────────────────────────
// Mirrors server/src/lib/orgMembers.ts (same values AND order — order is
// contractual, pinned by the orgMembers *Contract tests on both sides). This is
// separate from the account-level userRoles (coach/player) — membership grants
// access to an org's data, userRoles describes the account.
export const ORG_MEMBER_ROLES = [
  'owner',
  'head_coach',
  'junior_coach',
  'player',
] as const
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number]

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: 'Owner',
  head_coach: 'Head Coach',
  junior_coach: 'Junior Coach',
  player: 'Player',
}

// Roles assignable via invite. The owner role is never assigned — it exists
// only on the seeded owner row.
export const ORG_MEMBER_INVITE_ROLES = [
  'head_coach',
  'junior_coach',
  'player',
] as const
export type OrgMemberInviteRole = (typeof ORG_MEMBER_INVITE_ROLES)[number]

export type OrgMember = {
  id: string
  member_auth0_id: string | null
  member_email: string | null
  role: OrgMemberRole
  status: string
  display_name: string | null
  picture: string | null
  created_at: string
}

export type OrgMembersResponse = {
  members: OrgMember[]
  roles: OrgMemberRole[]
  current_user_role: OrgMemberRole | null
}

export const orgMembers = async (auth0Id: string): Promise<OrgMembersResponse> => {
  return queryJson<OrgMembersResponse>(org(auth0Id, '/members'))
}

export const orgInviteMember = async (
  auth0Id: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ member: OrgMember }> => {
  return mutateJson<{ member: OrgMember }>(org(auth0Id, '/members'), 'POST', input)
}

export const orgSetMemberRole = async (
  auth0Id: string,
  id: string,
  role: OrgMemberRole,
): Promise<{ member: OrgMember }> => {
  return mutateJson<{ member: OrgMember }>(
    org(auth0Id, `/members/${encodeURIComponent(id)}/role`),
    'PATCH',
    { role },
  )
}

export const orgRemoveMember = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    org(auth0Id, `/members/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export type OrgInvite = {
  id: string
  org_auth0_id: string
  email: string
  role: OrgMemberInviteRole
  created_by: string | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

export const orgInvites = async (auth0Id: string): Promise<{ invites: OrgInvite[] }> => {
  return queryJson<{ invites: OrgInvite[] }>(org(auth0Id, '/invites'))
}

export const orgMintInvite = async (
  auth0Id: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ invite: OrgInvite; token: string }> => {
  return mutateJson<{ invite: OrgInvite; token: string }>(org(auth0Id, '/invites'), 'POST', input)
}

export const orgRevokeInvite = async (
  auth0Id: string,
  id: string,
): Promise<{ revoked: boolean }> => {
  return mutateJson<{ revoked: boolean }>(
    org(auth0Id, `/invites/${encodeURIComponent(id)}/revoke`),
    'POST',
  )
}

export type AuditLog = {
  id: string
  org_auth0_id: string
  actor_auth0_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  result: string | null
  meta: Record<string, unknown>
  client_ip: string | null
  created_at: string
}

export const orgAuditLogs = async (auth0Id: string, limit = 50): Promise<{ logs: AuditLog[] }> => {
  return queryJson<{ logs: AuditLog[] }>(org(auth0Id, `/audit?limit=${limit}`))
}
