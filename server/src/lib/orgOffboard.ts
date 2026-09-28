// ── Member offboarding (custodian model) ───────────────────────────────────
// Data stays with the org: nothing cascades. The departing member loses their
// team rows (this org's teams only) and their membership row; their teams go
// to a named successor or, when none is named, the org owner acts as custodian
// (owners/admins are org-wide, so no team rows are needed for them).
//
// One transaction, fail-closed: the member row is locked first, the
// org_members row is deleted last, and there is no soft flag — every
// membership lookup would otherwise have to filter status forever.

import { withHistoryStoreOrThrow } from './historyStore'
import { hasPermission } from './permissions'
import type { OrgMemberRole } from './orgMembers'

export type OffboardFailure = { ok: false; status: 400 | 404 | 422; error: string }

export type OffboardSuccess = {
  ok: true
  role: string
  email: string | null
  /** This org's team ids the leaver held (now the successor's, or custodied). */
  teamIds: string[]
  /** Successor account sub, or null for the custodian path. */
  successorSub: string | null
}

export type OffboardResult = OffboardSuccess | OffboardFailure

type MemberRow = {
  id: string
  member_auth0_id: string | null
  member_email: string | null
  role: string
  status: string
}

/** The active membership row for an account, or null when not a member. */
export const findActiveMemberRowId = async (
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<string | null> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
      select id from org_members
      where org_auth0_id = ${orgAuth0Id}
        and member_auth0_id = ${memberAuth0Id}
        and status = 'active'
      limit 1;
    `
      return rows?.[0]?.id ?? null
    })) ?? null
  )
}

export const offboardMember = (
  orgAuth0Id: string,
  memberRowId: string,
  successorRowId: string | null,
  opts: { self?: boolean } = {},
): Promise<OffboardResult | null> =>
  withHistoryStoreOrThrow<OffboardResult>((db) =>
    db.begin(async (tx) => {
      const [leaver] = (await tx<MemberRow[]>`
        select member_auth0_id, member_email, role, status from org_members
        where org_auth0_id = ${orgAuth0Id} and id = ${memberRowId} for update;
      `) ?? []
      if (!leaver) return { ok: false, status: 404, error: 'Member not found' }
      if (leaver.role === 'owner' || leaver.member_auth0_id === orgAuth0Id) {
        return { ok: false, status: 400, error: 'The organization owner cannot be removed' }
      }
      if (opts.self && leaver.role === 'player') {
        return { ok: false, status: 400, error: 'Players are managed by their coach' }
      }

      // The successor must be a different, active member able to hold teams.
      // Owner/admin successors need no team rows (org-wide by policy).
      let successorSub: string | null = null
      let successorScoped = false
      if (successorRowId) {
        if (successorRowId === memberRowId) {
          return { ok: false, status: 422, error: 'The successor must be a different member' }
        }
        const [successor] = (await tx<MemberRow[]>`
          select member_auth0_id, member_email, role, status from org_members
          where org_auth0_id = ${orgAuth0Id} and id = ${successorRowId} for update;
        `) ?? []
        if (!successor || successor.status !== 'active') {
          return { ok: false, status: 422, error: 'The successor is not an active member' }
        }
        if (!hasPermission(successor.role as OrgMemberRole, 'team.manage_members')) {
          return {
            ok: false,
            status: 422,
            error: 'The successor cannot manage teams',
          }
        }
        if (!successor.member_auth0_id) {
          return {
            ok: false,
            status: 422,
            error: 'The successor has no linked account yet',
          }
        }
        successorSub = successor.member_auth0_id
        successorScoped =
          successor.role !== 'owner' &&
          successor.role !== 'admin' &&
          successorSub !== orgAuth0Id
      }

      // This org's teams only: the join keeps another org's rows for the same
      // account out of both the read and the delete below.
      const teamRows =
        leaver.member_auth0_id === null
          ? []
          : (await tx<{ team_id: string }[]>`
            select tm.team_id from team_memberships tm
            join teams t on t.id = tm.team_id
            where tm.member_auth0_id = ${leaver.member_auth0_id}
              and t.org_auth0_id = ${orgAuth0Id};
          `) ?? []
      const teamIds = teamRows.map((r) => r.team_id)

      if (leaver.member_auth0_id !== null) {
        await tx`
          delete from team_memberships
          where member_auth0_id = ${leaver.member_auth0_id}
            and team_id in (select id from teams where org_auth0_id = ${orgAuth0Id});
        `
      }
      if (successorSub && successorScoped) {
        for (const teamId of teamIds) {
          await tx`
            insert into team_memberships (team_id, member_auth0_id, student_id, role)
            values (${teamId}, ${successorSub}, null, 'coach')
            on conflict (team_id, member_auth0_id, student_id) do nothing;
          `
        }
      }

      // Deleted last, in the same transaction: a failure above rolls back to
      // full membership, never to a member without teams.
      await tx`
        delete from org_members
        where org_auth0_id = ${orgAuth0Id} and id = ${memberRowId};
      `
      return {
        ok: true,
        role: leaver.role,
        email: leaver.member_email,
        teamIds,
        successorSub,
      }
    }),
  )
