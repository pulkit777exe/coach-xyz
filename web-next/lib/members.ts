import { apiFetch, IDENTITY_BASE } from "./api";

const org = (auth0Id: string, path: string) =>
  `${IDENTITY_BASE}/api/org/${encodeURIComponent(auth0Id)}${path}`;

// ── Org-member role vocabulary ──────────────────────────────────────────────
// Mirrors server/src/lib/orgMembers.ts (same values AND order — order is
// contractual, pinned by the orgMembers *Contract tests on both sides). This is
// separate from the account-level userRoles (coach/player) — membership grants
// access to an org's data, userRoles describes the account.
export const ORG_MEMBER_ROLES = ["owner", "admin", "coach", "player"] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
  player: "Player",
};

// Roles assignable via invite. The owner role is never assigned — it exists
// only on the seeded owner row.
export const ORG_MEMBER_INVITE_ROLES = ["admin", "coach", "player"] as const;
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