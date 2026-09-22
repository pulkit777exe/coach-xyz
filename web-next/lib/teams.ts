import { apiFetch, IDENTITY_BASE } from "./api";

const team = (auth0Id: string, path: string) =>
  `${IDENTITY_BASE}/api/org/${encodeURIComponent(auth0Id)}/teams${path}`;

export type Team = {
  id: string;
  org_auth0_id: string;
  name: string;
  sport: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamMember = {
  id: string;
  team_id: string;
  member_auth0_id: string | null;
  student_id: string | null;
  role: string;
  created_at: string;
};

export const listTeams = async (auth0Id: string): Promise<{ teams: Team[] }> =>
  apiFetch<{ teams: Team[] }>(team(auth0Id, ""));

export const createTeam = async (
  auth0Id: string,
  input: { name: string; sport?: string | null },
): Promise<{ team: Team }> =>
  apiFetch<{ team: Team }>(team(auth0Id, ""), {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getTeam = async (
  auth0Id: string,
  teamId: string,
): Promise<{ team: Team }> =>
  apiFetch<{ team: Team }>(team(auth0Id, `/${encodeURIComponent(teamId)}`));

export const renameTeam = async (
  auth0Id: string,
  teamId: string,
  name: string,
): Promise<{ team: Team }> =>
  apiFetch<{ team: Team }>(team(auth0Id, `/${encodeURIComponent(teamId)}`), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteTeam = async (
  auth0Id: string,
  teamId: string,
): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(team(auth0Id, `/${encodeURIComponent(teamId)}`), {
    method: "DELETE",
  });

export const listTeamMembers = async (
  auth0Id: string,
  teamId: string,
): Promise<{ members: TeamMember[] }> =>
  apiFetch<{ members: TeamMember[] }>(
    team(auth0Id, `/${encodeURIComponent(teamId)}/members`),
  );

export const addTeamMember = async (
  auth0Id: string,
  teamId: string,
  input: { member_auth0_id?: string | null; student_id?: string | null; role?: string },
): Promise<{ member: TeamMember }> =>
  apiFetch<{ member: TeamMember }>(
    team(auth0Id, `/${encodeURIComponent(teamId)}/members`),
    { method: "POST", body: JSON.stringify(input) },
  );

export const removeTeamMember = async (
  auth0Id: string,
  teamId: string,
  membershipId: string,
): Promise<{ deleted: boolean }> =>
  apiFetch<{ deleted: boolean }>(
    team(auth0Id, `/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}`),
    { method: "DELETE" },
  );
