import { apiFetch, IDENTITY_BASE } from "./api";

const org = (auth0Id: string, path: string) =>
  `${IDENTITY_BASE}/api/org/${encodeURIComponent(auth0Id)}${path}`;

// ── Org-member role vocabulary ──────────────────────────────────────────────
// Mirrors server/src/lib/orgMembers.ts (same values AND order — order is
// contractual, pinned by the orgMembers *Contract tests on both sides). This is
// separate from the account-level userRoles (coach/player) — membership grants
// access to an org's data, userRoles describes the account.
export const ORG_MEMBER_ROLES = ["owner", "admin", "coach", "analyst", "medical", "player"] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
  analyst: "Analyst",
  medical: "Medical",
  player: "Player",
};

// Roles assignable via invite. The owner role is never assigned — it exists
// only on the seeded owner row.
export const ORG_MEMBER_INVITE_ROLES = ["admin", "coach", "analyst", "medical", "player"] as const;
export type OrgMemberInviteRole = (typeof ORG_MEMBER_INVITE_ROLES)[number];

export type OrgMember = {
  id: string;
  member_auth0_id: string | null;
  member_email: string | null;
  role: OrgMemberRole;
  status: string;
  display_name: string | null;
  picture: string | null;
  created_at: string;
};

export type OrgMembersResponse = {
  members: OrgMember[];
  roles: OrgMemberRole[];
  current_user_role: OrgMemberRole | null;
};

export const orgMembers = async (auth0Id: string): Promise<OrgMembersResponse> => {
  return apiFetch<OrgMembersResponse>(org(auth0Id, "/members"));
};

export const orgInviteMember = async (
  auth0Id: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ member: OrgMember }> => {
  return apiFetch<{ member: OrgMember }>(org(auth0Id, "/members"), {
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const orgSetMemberRole = async (
  auth0Id: string,
  id: string,
  role: OrgMemberRole,
): Promise<{ member: OrgMember }> => {
  return apiFetch<{ member: OrgMember }>(
    org(auth0Id, `/members/${encodeURIComponent(id)}/role`),
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
};

export const orgRemoveMember = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return apiFetch<{ deleted: boolean }>(org(auth0Id, `/members/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
};

export type OrgInvite = {
  id: string;
  org_auth0_id: string;
  email: string;
  role: OrgMemberInviteRole;
  created_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export const orgInvites = async (auth0Id: string): Promise<{ invites: OrgInvite[] }> => {
  return apiFetch<{ invites: OrgInvite[] }>(org(auth0Id, "/invites"));
};

export const orgMintInvite = async (
  auth0Id: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ invite: OrgInvite; token: string }> => {
  return apiFetch<{ invite: OrgInvite; token: string }>(org(auth0Id, "/invites"), {
    method: "POST",
    body: JSON.stringify(input),
  });
};

export const orgRevokeInvite = async (
  auth0Id: string,
  id: string,
): Promise<{ revoked: boolean }> => {
  return apiFetch<{ revoked: boolean }>(org(auth0Id, `/invites/${encodeURIComponent(id)}/revoke`), {
    method: "POST",
  });
};

export type AuditLog = {
  id: string;
  org_auth0_id: string;
  actor_auth0_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  result: string | null;
  meta: Record<string, unknown>;
  client_ip: string | null;
  created_at: string;
};

export const orgAuditLogs = async (
  auth0Id: string,
  limit = 50,
): Promise<{ logs: AuditLog[] }> => {
  return apiFetch<{ logs: AuditLog[] }>(org(auth0Id, `/audit?limit=${limit}`));
};