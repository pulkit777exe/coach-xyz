import { SQL } from "bun"

import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from "./supabaseHistory"

// ── Teams ────────────────────────────────────────────────────────────────────
// Teams scope students, analyses, and coaching permissions inside an org.
// Every team belongs to exactly one org (org_auth0_id); membership rows link
// either an org member (coach-side, member_auth0_id) or a student row
// (player-side, student_id).

export type Team = {
  id: string
  org_auth0_id: string
  name: string
  sport: string | null
  created_at: string
  updated_at: string
}

export type TeamMember = {
  id: string
  team_id: string
  member_auth0_id: string | null
  student_id: string | null
  role: string
  created_at: string
}

const TEAM_MEMBER_ROLES = ["coach", "player"] as const
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number]

const ensureSchema = async (db: SQL) => {
  await ensureInitialized()
  await db`
    create table if not exists teams (
      id uuid primary key default gen_random_uuid(),
      org_auth0_id text not null,
      name text not null,
      sport text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `
  await db`
    create index if not exists idx_teams_org_auth0_id
    on teams (org_auth0_id);
  `
  await db`
    create table if not exists team_memberships (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null references teams (id) on delete cascade,
      member_auth0_id text,
      student_id uuid,
      role text not null default 'player'
        check (role in ('coach', 'player')),
      created_at timestamptz not null default now(),
      constraint team_memberships_unique unique (team_id, member_auth0_id, student_id),
      constraint team_memberships_target_check
        check (member_auth0_id is not null or student_id is not null)
    );
  `
  await db`
    create index if not exists idx_team_memberships_team_id
    on team_memberships (team_id);
  `
  await db`
    create index if not exists idx_team_memberships_member
    on team_memberships (member_auth0_id);
  `
  // Students gain an optional team assignment (nullable = unassigned).
  await db`alter table students add column if not exists team_id uuid;`
  await db`
    create index if not exists idx_students_team_id
    on students (team_id);
  `
}

export const createTeam = async (
  orgAuth0Id: string,
  input: { name: string; sport?: string | null },
): Promise<Team | null> => {
  const name = input.name.trim().slice(0, 120)
  if (!name) return null
  return withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<Team[]>`
      insert into teams (org_auth0_id, name, sport)
      values (${orgAuth0Id}, ${name}, ${input.sport?.trim().slice(0, 60) || null})
      returning id, org_auth0_id, name, sport, created_at, updated_at;
    `
    return rows?.[0] ?? null
  })
}

export const listTeams = async (orgAuth0Id: string): Promise<Team[]> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<Team[]>`
      select id, org_auth0_id, name, sport, created_at, updated_at
      from teams
      where org_auth0_id = ${orgAuth0Id}
      order by created_at asc;
    `
    return rows ?? []
  })) ?? []
}

export const getTeam = async (
  orgAuth0Id: string,
  teamId: string,
): Promise<Team | null> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<Team[]>`
      select id, org_auth0_id, name, sport, created_at, updated_at
      from teams
      where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
      limit 1;
    `
    return rows?.[0] ?? null
  })) ?? null
}

export const renameTeam = async (
  orgAuth0Id: string,
  teamId: string,
  name: string,
): Promise<Team | null> => {
  const clean = name.trim().slice(0, 120)
  if (!clean) return null
  return withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<Team[]>`
      update teams set name = ${clean}, updated_at = now()
      where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
      returning id, org_auth0_id, name, sport, created_at, updated_at;
    `
    return rows?.[0] ?? null
  })
}

export const deleteTeam = async (
  orgAuth0Id: string,
  teamId: string,
): Promise<boolean> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    // Unassign students first (team_id is a loose link, not a FK).
    await db`update students set team_id = null where team_id = ${teamId};`
    const rows = await db<{ id: string }[]>`
      delete from teams
      where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
      returning id;
    `
    return Boolean(rows?.[0])
  })) ?? false
}

export const listTeamMembers = async (teamId: string): Promise<TeamMember[]> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<TeamMember[]>`
      select id, team_id, member_auth0_id, student_id, role, created_at
      from team_memberships
      where team_id = ${teamId}
      order by created_at asc;
    `
    return rows ?? []
  })) ?? []
}

/** Team ids a member belongs to (coach-side link). */
export const listMemberTeamIds = async (memberAuth0Id: string): Promise<string[]> => {
  const rows = (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const ids = await db<{ team_id: string }[]>`
      select team_id from team_memberships
      where member_auth0_id = ${memberAuth0Id};
    `
    return ids ?? []
  })) ?? []
  return rows.map((r) => r.team_id)
}

export const addTeamMember = async (
  teamId: string,
  input: { memberAuth0Id?: string | null; studentId?: string | null; role?: TeamMemberRole },
): Promise<TeamMember | null> => {
  const memberAuth0Id = input.memberAuth0Id?.trim() || null
  const studentId = input.studentId?.trim() || null
  if (!memberAuth0Id && !studentId) return null
  const role: TeamMemberRole = TEAM_MEMBER_ROLES.includes(
    input.role as TeamMemberRole,
  )
    ? (input.role as TeamMemberRole)
    : "player"
  return withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<TeamMember[]>`
      insert into team_memberships (team_id, member_auth0_id, student_id, role)
      values (
        ${teamId},
        ${memberAuth0Id},
        ${studentId}::uuid,
        ${role}
      )
      on conflict (team_id, member_auth0_id, student_id)
      do update set role = excluded.role
      returning id, team_id, member_auth0_id, student_id, role, created_at;
    `
    return rows?.[0] ?? null
  })
}

export const removeTeamMember = async (teamId: string, membershipId: string): Promise<boolean> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<{ id: string }[]>`
      delete from team_memberships
      where team_id = ${teamId} and id = ${membershipId}
      returning id;
    `
    return Boolean(rows?.[0])
  })) ?? false
}
