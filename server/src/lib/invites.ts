import { createHash, randomBytes } from 'node:crypto'

import { withHistoryStoreOrThrow } from './historyStore'
import { inviteOrgMemberWithId, type OrgMemberInviteRole } from './orgMembers'
import { getUserByAuth0Id, resolveAuth0Id } from './users'
import { logger } from './logger'

// ── Organization invitations (§7) ───────────────────────────────────────────
// Staff invites are token-based: cryptographically random, stored hashed,
// short-lived (7 days), single-use, revocable. The raw token is returned once
// at mint time (for the invite email link) and never stored.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

// Schema (org_invites) lives in ensureInitialized (historyStore.ts); these
// helpers only defer to it.

export const mintInvite = async (
  orgAuth0Id: string,
  createdBy: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ invite: OrgInvite; token: string } | null> => {
  const email = input.email.trim().toLowerCase()
  if (!email) return null
  const token = randomBytes(32).toString('hex')
  const created = await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<OrgInvite[]>`
      insert into org_invites (org_auth0_id, email, role, token_hash, created_by, expires_at)
      values (
        ${orgAuth0Id},
        ${email},
        ${input.role},
        ${hashToken(token)},
        ${createdBy},
        now() + (${INVITE_TTL_MS} || ' milliseconds')::interval
      )
      returning id, org_auth0_id, email, role, created_by, expires_at,
        accepted_at, revoked_at, created_at;
    `
    return rows?.[0] ?? null
  })
  if (!created) return null
  return { invite: created, token }
}

export const listInvites = async (orgAuth0Id: string): Promise<OrgInvite[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<OrgInvite[]>`
      select id, org_auth0_id, email, role, created_by, expires_at,
        accepted_at, revoked_at, created_at
      from org_invites
      where org_auth0_id = ${orgAuth0Id}
      order by created_at desc;
    `
      return rows ?? []
    })) ?? []
  )
}

export const revokeInvite = async (orgAuth0Id: string, inviteId: string): Promise<boolean> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<{ id: string }[]>`
      update org_invites set revoked_at = now()
      where org_auth0_id = ${orgAuth0Id}
        and id = ${inviteId}
        and accepted_at is null
        and revoked_at is null
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

export type AcceptInviteResult =
  { ok: true; orgAuth0Id: string; role: OrgMemberInviteRole } | { ok: false; error: string }

/**
 * Redeem an invite token for the verified caller. Single-use: the row is
 * marked accepted before linking, and expired/revoked/consumed tokens are
 * rejected without revealing which (uniform "invalid or expired").
 */
export const acceptInvite = async (
  token: string,
  callerAuth0Id: string,
): Promise<AcceptInviteResult> => {
  if (!token || typeof token !== 'string')
    return { ok: false, error: 'Invalid or expired invitation' }
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      // Read the invite, do NOT consume it yet.
      const rows = await db<OrgInvite[]>`
      select org_auth0_id, email, role, created_by, accepted_at
      from org_invites
      where token_hash = ${hashToken(token)}
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      limit 1;
    `
      const invite = rows?.[0]
      if (!invite) return { ok: false, error: 'Invalid or expired invitation' }

      // Bind acceptance to the invited identity. The token alone must not grant
      // membership: anyone holding the link could otherwise consume it, and a
      // caller whose email differs would get `{ ok: true }` with no membership
      // (the write keys on the invite's email, not the caller). Resolve linked
      // accounts to the primary id first, then require a verified account whose
      // email matches the invite. A rejection here answers the uniform error
      // and leaves the token unconsumed, so the right person can still use it.
      const primary = await resolveAuth0Id(callerAuth0Id)
      const caller = await getUserByAuth0Id(primary)
      const callerEmail = caller?.email?.trim().toLowerCase() ?? null
      if (!caller || caller.email_verified !== true || callerEmail !== invite.email.trim().toLowerCase()) {
        return { ok: false, error: 'Invalid or expired invitation' }
      }

      // Link the caller's account explicitly (member_auth0_id = verified
      // caller), never via an email lookup that could land on another row.
      // This runs BEFORE the token is consumed and its result is checked, which
      // is the whole fix: the order used to be consume-then-write, the return
      // value was discarded, and the membership write has several `return null`
      // paths. So a single failed membership write produced `{ ok: true }` —
      // the UI said "you're in the club" — while every org route then 403'd
      // the user (`getMemberRole` returned null) and the single-use token was
      // already burnt, so there was no retry. Writing first means a failure
      // leaves the token usable, and re-accepting is idempotent because the
      // write updates the existing row when there is one.
      const member = await inviteOrgMemberWithId(
        invite.org_auth0_id,
        invite.created_by ?? primary,
        {
          email: invite.email,
          role: invite.role as OrgMemberInviteRole,
          memberAuth0Id: primary,
        },
      )
      if (!member) {
        logger.error('invite_membership_write_failed', {
          type: 'invite_membership_write_failed',
          org: invite.org_auth0_id,
          email: invite.email,
          role: invite.role,
        })
        return { ok: false, error: 'Could not complete the invitation' }
      }

      // Consume the token last. `accepted_at is null` keeps this single-use even
      // if two requests race: both may read the row, but the membership write is
      // idempotent and the second consume simply matches nothing.
      const consumed = await db<{ token_hash: string }[]>`
        update org_invites set accepted_at = now()
        where token_hash = ${hashToken(token)} and accepted_at is null
        returning token_hash;
      `
      if (!consumed?.[0]) {
        // Another request consumed it first. The membership is written either
        // way, so this is still a success from the caller's point of view.
        logger.info('invite_already_consumed', {
          type: 'invite_already_consumed',
          org: invite.org_auth0_id,
        })
      }
      return {
        ok: true,
        orgAuth0Id: invite.org_auth0_id,
        role: invite.role as OrgMemberInviteRole,
      }
    })) ?? { ok: false, error: 'Invitation service unavailable' }
  )
}
