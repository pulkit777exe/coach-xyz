import { SQL } from 'bun'
import { createHash, randomBytes } from 'node:crypto'

import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from './historyStore'
import { inviteOrgMember, type OrgMemberInviteRole } from './orgMembers'

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

const ensureSchema = async (db: SQL) => {
  await ensureInitialized()
  await db`
    create table if not exists org_invites (
      id uuid primary key default gen_random_uuid(),
      org_auth0_id text not null,
      email text not null,
      role text not null,
      token_hash text not null unique,
      created_by text,
      expires_at timestamptz not null,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );
  `
  await db`
    create index if not exists idx_org_invites_org_auth0_id
    on org_invites (org_auth0_id);
  `
  await db`
    create index if not exists idx_org_invites_token_hash
    on org_invites (token_hash);
  `
}

export const mintInvite = async (
  orgAuth0Id: string,
  createdBy: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<{ invite: OrgInvite; token: string } | null> => {
  const email = input.email.trim().toLowerCase()
  if (!email) return null
  const token = randomBytes(32).toString('hex')
  const created = await withHistoryStore(async (db) => {
    await ensureSchema(db)
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
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
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
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
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
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
      const rows = await db<OrgInvite[]>`
      update org_invites set accepted_at = now()
      where token_hash = ${hashToken(token)}
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      returning org_auth0_id, email, role, created_by;
    `
      const invite = rows?.[0]
      if (!invite) return { ok: false, error: 'Invalid or expired invitation' }
      // Link the caller's account (matches by users.email like direct invites).
      await inviteOrgMember(invite.org_auth0_id, invite.created_by ?? callerAuth0Id, {
        email: invite.email,
        role: invite.role as OrgMemberInviteRole,
      })
      return {
        ok: true,
        orgAuth0Id: invite.org_auth0_id,
        role: invite.role as OrgMemberInviteRole,
      }
    })) ?? { ok: false, error: 'Invitation service unavailable' }
  )
}
