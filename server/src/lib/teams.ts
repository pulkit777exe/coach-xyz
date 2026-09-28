import { withHistoryStoreOrThrow } from './historyStore'

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

const TEAM_MEMBER_ROLES = ['coach', 'player'] as const
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number]

// Schema (teams, team_memberships, students.team_id) lives in
// ensureInitialized (historyStore.ts); these helpers only defer to it.

export const createTeam = async (
  orgAuth0Id: string,
  input: { name: string; sport?: string | null },
): Promise<Team | null> => {
  const name = input.name.trim().slice(0, 120)
  if (!name) return null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<Team[]>`
      insert into teams (org_auth0_id, name, sport)
      values (${orgAuth0Id}, ${name}, ${input.sport?.trim().slice(0, 60) || null})
      returning id, org_auth0_id, name, sport, created_at, updated_at;
    `
    return rows?.[0] ?? null
  })
}

export const listTeams = async (orgAuth0Id: string): Promise<Team[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<Team[]>`
      select id, org_auth0_id, name, sport, created_at, updated_at
      from teams
      where org_auth0_id = ${orgAuth0Id}
      order by created_at asc;
    `
      return rows ?? []
    })) ?? []
  )
}

export const getTeam = async (orgAuth0Id: string, teamId: string): Promise<Team | null> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<Team[]>`
      select id, org_auth0_id, name, sport, created_at, updated_at
      from teams
      where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
      limit 1;
    `
      return rows?.[0] ?? null
    })) ?? null
  )
}

export const renameTeam = async (
  orgAuth0Id: string,
  teamId: string,
  name: string,
): Promise<Team | null> => {
  const clean = name.trim().slice(0, 120)
  if (!clean) return null
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<Team[]>`
      update teams set name = ${clean}, updated_at = now()
      where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
      returning id, org_auth0_id, name, sport, created_at, updated_at;
    `
    return rows?.[0] ?? null
  })
}

export const deleteTeam = async (orgAuth0Id: string, teamId: string): Promise<boolean> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      // Claim the team for THIS org before touching anything it points at.
      // `students.team_id` is a loose link rather than a foreign key, so the
      // schema cannot scope the unassign to an org: `where team_id = ?` matches
      // any org's team, because a team uuid is globally unique. The old order
      // unassigned first and asked the org question second, so a caller from
      // another org who knew the uuid cleared every player's team_id --
      // committed -- and then answered 404, because their own org did not own
      // the team. The victim org's coach was left looking at an empty roster,
      // since visibleStudentIds resolves their scope by team_id.
      //
      // The row lock also serializes two concurrent deletes: without it both
      // callers could read the row, then both unassign, then both delete.
      const claimed = await db<{ id: string }[]>`
        select id from teams
        where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
        for update;
      `
      if (!claimed?.[0]) return false

      // Only now, with ownership established. The org predicate stays in the
      // statement so the invariant is local to this write rather than resting
      // on a check the caller is trusted to have made.
      await db`
        update students set team_id = null
        where team_id = ${teamId}
          and exists (
            select 1 from teams t
            where t.id = ${teamId} and t.org_auth0_id = ${orgAuth0Id}
          );
      `
      // team_memberships cascades on team_id, so the memberships go with it.
      const rows = await db<{ id: string }[]>`
        delete from teams
        where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
        returning id;
      `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

export const listTeamMembers = async (teamId: string): Promise<TeamMember[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<TeamMember[]>`
      select id, team_id, member_auth0_id, student_id, role, created_at
      from team_memberships
      where team_id = ${teamId}
      order by created_at asc;
    `
      return rows ?? []
    })) ?? []
  )
}

/**
 * Team ids a member holds in ONE org (coach-side link). Scoped by joining
 * `teams`: the unscoped variant returned team ids across every org the user
 * belonged to, so a coach with teams in two orgs carried the other org's
 * teams into this org's scope (`resolveCaller` → `studentScope`).
 */
export const listMemberTeamIdsInOrg = async (
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<string[]> => {
  const rows =
    (await withHistoryStoreOrThrow(async (db) => {
      const ids = await db<{ team_id: string }[]>`
      select tm.team_id from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.member_auth0_id = ${memberAuth0Id}
        and t.org_auth0_id = ${orgAuth0Id};
    `
      return ids ?? []
    })) ?? []
  return rows.map((r) => r.team_id)
}

export const addTeamMember = async (
  teamId: string,
  input: {
    memberAuth0Id?: string | null
    studentId?: string | null
    role?: TeamMemberRole
  },
): Promise<TeamMember | null> => {
  const memberAuth0Id = input.memberAuth0Id?.trim() || null
  const studentId = input.studentId?.trim() || null
  if (!memberAuth0Id && !studentId) return null
  const role: TeamMemberRole = TEAM_MEMBER_ROLES.includes(input.role as TeamMemberRole)
    ? (input.role as TeamMemberRole)
    : 'player'
  return withHistoryStoreOrThrow(async (db) => {
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
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
      delete from team_memberships
      where team_id = ${teamId} and id = ${membershipId}
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

/** One membership row, for deciding whether a removal is a coach or a student. */
export const getTeamMembership = async (
  teamId: string,
  membershipId: string,
): Promise<TeamMember | null> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<TeamMember[]>`
      select id, team_id, member_auth0_id, student_id, role, created_at
      from team_memberships
      where team_id = ${teamId} and id = ${membershipId}
      limit 1;
    `
      return rows?.[0] ?? null
    })) ?? null
  )
}

export type StudentTeamChange = {
  /** The mirrored membership row (the route's `{ member }` shape is unchanged). */
  member: TeamMember | null
  /** Team the student leaves, null when unassigned. */
  fromTeamId: string | null
  /** Team the student joins, null when unassigned. */
  toTeamId: string | null
  /** Fresh student row after the move. */
  student: {
    id: string
    auth0_id: string
    full_name: string
    team_id: string | null
  } | null
}

/**
 * Move a student between teams (or off teams) with the membership mirror kept
 * in one transaction. `students.team_id` is the scope source of truth, so a
 * `team_memberships` row without it leaves the player invisible to the team's
 * coaches, and a `team_id` without the row hides them from the team roster —
 * both halves are written here, never separately.
 *
 * Returns null when the student or (when set) the team is not in this org.
 */
export const setStudentTeam = async (
  orgAuth0Id: string,
  studentId: string,
  teamId: string | null,
): Promise<StudentTeamChange | null> =>
  withHistoryStoreOrThrow((db) =>
    db.begin(async (tx) => {
      const owned = await tx<{ id: string; team_id: string | null }[]>`
        select id, team_id from students
        where auth0_id = ${orgAuth0Id} and id = ${studentId}
        for update;
      `
      const current = owned?.[0]
      if (!current) return null
      if (teamId) {
        const team = await tx<{ id: string }[]>`
          select id from teams
          where org_auth0_id = ${orgAuth0Id} and id = ${teamId}
          limit 1;
        `
        if (!team?.[0]) return null
      }
      const updated = await tx<StudentTeamChange['student'][]>`
        update students set team_id = ${teamId}, updated_at = now()
        where auth0_id = ${orgAuth0Id} and id = ${studentId}
        returning id, auth0_id, full_name, team_id;
      `
      // Drop this student's membership rows in the org's teams, then mirror
      // the new assignment. Scoped by joining teams: a bare
      // `where student_id = ?` would touch another org's rows on a uuid that
      // collides across tenants only by attacker construction — the claim
      // above already established ownership, the join keeps it local anyway.
      await tx`
        delete from team_memberships
        where student_id = ${studentId}
          and team_id in (select id from teams where org_auth0_id = ${orgAuth0Id});
      `
      let member: TeamMember | null = null
      if (teamId) {
        const inserted = await tx<TeamMember[]>`
          insert into team_memberships (team_id, member_auth0_id, student_id, role)
          values (${teamId}, null, ${studentId}, 'player')
          on conflict (team_id, member_auth0_id, student_id) do nothing
          returning id, team_id, member_auth0_id, student_id, role, created_at;
        `
        member =
          inserted?.[0] ??
          (
            await tx<TeamMember[]>`
            select id, team_id, member_auth0_id, student_id, role, created_at
            from team_memberships
            where team_id = ${teamId} and student_id = ${studentId}
            limit 1;
          `
          )?.[0] ?? null
      }
      return {
        member,
        fromTeamId: current.team_id,
        toTeamId: teamId,
        student: updated?.[0] ?? null,
      }
    }),
  )
