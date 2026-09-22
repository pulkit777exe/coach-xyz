import { SQL } from "bun"

import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from "./supabaseHistory"

// ── Org-member role vocabulary ──────────────────────────────────────────────
// Single source of truth for org membership roles. Mirrored on the web
// (web-next/lib/members.ts) with values AND order pinned contractually by the
// orgMembers *Contract tests on both sides. This is a SEPARATE vocabulary from
// the users.role enum (coach/player in server/src/lib/userRoles.ts) — org
// membership grants access to an org's data, user.role describes the account.
export const ORG_MEMBER_ROLES = ["owner", "admin", "coach", "analyst", "medical", "player"] as const
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number]

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  coach: "Coach",
  analyst: "Analyst",
  medical: "Medical",
  player: "Player",
}

// Roles an inviter may assign when adding a member. The owner role is never
// assigned via invite — it exists only on the seeded owner row.
export const ORG_MEMBER_INVITE_ROLES = ["admin", "coach", "analyst", "medical", "player"] as const
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

// Shared select for org_members joined with users (display name/picture).
// Written as a SQL fragment used via db.unsafe inside a select, mirroring
// ANALYSES_SELECT_COLUMNS in supabaseHistory.ts.
const MEMBER_SELECT_COLUMNS = `
  m.id,
  m.member_auth0_id,
  coalesce(m.member_email, u.email) as member_email,
  m.role,
  m.status,
  coalesce(u.name, u.nickname, m.member_email, u.email) as display_name,
  u.picture,
  m.created_at
`

/** Creates the org_members table if it does not exist (idempotent). */
const ensureSchema = async (db: SQL) => {
  await ensureInitialized()
  await db`
    create table if not exists org_members (
      id uuid primary key default gen_random_uuid(),
      org_auth0_id text not null,
      member_auth0_id text,
      member_email text,
      role text not null check (role in ('owner','admin','coach','analyst','medical','player')),
      status text not null default 'active',
      invited_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint org_members_unique unique (org_auth0_id, member_auth0_id)
    );
  `
  // Migrate pre-existing tables whose CHECK still lists only the four
  // original roles: drop the old role check (name discovered dynamically)
  // and re-add the six-role version. Idempotent.
  await db`
    do $$
    declare _conname text;
    begin
      select conname into _conname
      from pg_constraint
      where conrelid = 'org_members'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%role in%';
      if _conname is not null and _conname <> 'org_members_role_check' then
        execute format('alter table org_members drop constraint %I', _conname);
      end if;
    end
    $$;
  `
  await db`
    alter table org_members
      drop constraint if exists org_members_role_check;
  `
  await db`
    alter table org_members
      add constraint org_members_role_check
      check (role in ('owner','admin','coach','analyst','medical','player'));
  `
  await db`
    create index if not exists idx_org_members_org_auth0_id
    on org_members (org_auth0_id);
  `
  await db`
    create index if not exists idx_org_members_member_auth0_id
    on org_members (member_auth0_id);
  `
}

/** Bootstraps the org_members schema inside the shared history-store setup. */
export const ensureOrgMembersInitialized = async (): Promise<void> => {
  await withHistoryStore((db) => ensureSchema(db))
}

/**
 * Idempotently seeds the owner row for a coach's org. Each org gets exactly one
 * owner: the coach who created it (org_auth0_id === member_auth0_id).
 */
export const ensureOrgOwner = async (auth0Id: string): Promise<void> => {
  await withHistoryStore(async (db) => {
    await ensureSchema(db)
    await db`
      insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status)
      select ${auth0Id}, ${auth0Id}, u.email, 'owner', 'active'
      from (select 1) src
      left join users u on u.auth0_id = ${auth0Id}
      on conflict (org_auth0_id, member_auth0_id) do nothing;
    `
  })
}

const loadMemberById = async (
  db: SQL,
  orgAuth0Id: string,
  id: string,
): Promise<OrgMember | null> => {
  const rows = await db<OrgMember[]>`
    select ${db.unsafe(MEMBER_SELECT_COLUMNS)}
    from org_members m
    left join users u on u.auth0_id = m.member_auth0_id
    where m.org_auth0_id = ${orgAuth0Id} and m.id = ${id}
    limit 1;
  `
  return rows?.[0] ?? null
}

/**
 * Lists an org's members (joined with users for display). Lazily seeds the
 * owner row first so existing coaches get an owner membership on first read —
 * no migration needed.
 */
export const listOrgMembers = async (orgAuth0Id: string): Promise<OrgMember[]> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    await db`
      insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status)
      select ${orgAuth0Id}, ${orgAuth0Id}, u.email, 'owner', 'active'
      from (select 1) src
      left join users u on u.auth0_id = ${orgAuth0Id}
      on conflict (org_auth0_id, member_auth0_id) do nothing;
    `
    const rows = await db<OrgMember[]>`
      select ${db.unsafe(MEMBER_SELECT_COLUMNS)}
      from org_members m
      left join users u on u.auth0_id = m.member_auth0_id
      where m.org_auth0_id = ${orgAuth0Id}
      order by
        case m.role
          when 'owner' then 0
          when 'admin' then 1
          when 'coach' then 2
          when 'analyst' then 3
          when 'medical' then 4
          else 5
        end,
        coalesce(u.name, m.member_email) asc nulls last;
    `
    return rows ?? []
  })) ?? []
}

export type OrgMembership = {
  org_auth0_id: string
  role: OrgMemberRole
  display_name: string | null
}

/**
 * Lists the orgs a member belongs to (active rows only), for org-context
 * resolution on the self-scoped /api/me/orgs route. Owner rows are ordered
 * first so a caller who owns an org resolves it as their primary context.
 */
export const listMembershipsForUser = async (
  memberAuth0Id: string,
): Promise<OrgMembership[]> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    // Lazily seed owner-of-self so fresh solo coaches always see their own
    // org in the switcher (mirrors listOrgMembers seeding). Only for real
    // users — avoids creating phantom orgs for arbitrary ids.
    await db`
      insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status)
      select ${memberAuth0Id}, ${memberAuth0Id}, u.email, 'owner', 'active'
      from users u where u.auth0_id = ${memberAuth0Id}
      on conflict (org_auth0_id, member_auth0_id) do nothing;
    `
    const rows = await db<OrgMembership[]>`
      select
        m.org_auth0_id,
        m.role,
        coalesce(u.name, u.nickname, m.member_email, m.org_auth0_id) as display_name
      from org_members m
      left join users u on u.auth0_id = m.org_auth0_id
      where m.member_auth0_id = ${memberAuth0Id}
        and m.status = 'active'
      order by
        case m.role when 'owner' then 0 else 1 end,
        m.created_at asc;
    `
    return rows ?? []
  })) ?? []
}

export const getOrgMember = async (
  orgAuth0Id: string,
  id: string,
): Promise<OrgMember | null> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    return loadMemberById(db, orgAuth0Id, id)
  })) ?? null
}

/**
 * Resolves a caller's role within an org, used by the service guard to authorize
 * non-owner members (multi-coach data access). Owner fast-path: when the caller
 * IS the org (auth0Id === orgAuth0Id) they are the seeded owner — no DB hit.
 * Otherwise only ACTIVE rows whose member_auth0_id matches grant access, so an
 * invited-but-unlinked or removed member is denied. Returns null when the caller
 * has no active membership.
 */
export const getMemberRole = async (
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<OrgMemberRole | null> => {
  if (memberAuth0Id === orgAuth0Id) return "owner"
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<{ role: OrgMemberRole }[]>`
      select role from org_members
      where org_auth0_id = ${orgAuth0Id}
        and member_auth0_id = ${memberAuth0Id}
        and status = 'active'
      limit 1;
    `
    return rows?.[0]?.role ?? null
  })) ?? null
}

/**
 * Invites a staff member by email. If a `users` row already exists with that
 * email, the row is linked immediately (member_auth0_id captures the account).
 * Re-inviting an existing email updates its role; the owner can never be
 * invited/overwritten.
 */
export const inviteOrgMember = async (
  orgAuth0Id: string,
  inviterAuth0Id: string,
  input: { email: string; role: OrgMemberInviteRole },
): Promise<OrgMember | null> => {
  const email = input.email.trim().toLowerCase()
  if (!email) return null
  return withHistoryStore(async (db) => {
    await ensureSchema(db)

    const account = await db<{ auth0_id: string }[]>`
      select auth0_id from users where lower(email) = ${email} limit 1;
    `
    const memberAuth0Id = account?.[0]?.auth0_id ?? null
    if (memberAuth0Id === orgAuth0Id) return null

    const existing = await db<{ id: string }[]>`
      select id from org_members
      where org_auth0_id = ${orgAuth0Id}
        and (lower(member_email) = ${email} or member_auth0_id = ${memberAuth0Id})
      limit 1;
    `
    if (existing?.[0]) {
      const rows = await db<OrgMember[]>`
        update org_members set
          role = ${input.role},
          status = 'active',
          member_email = ${email},
          member_auth0_id = coalesce(${memberAuth0Id}, member_auth0_id),
          invited_by = ${inviterAuth0Id},
          updated_at = now()
        where id = ${existing[0].id}
        returning id;
      `
      if (!rows?.[0]) return null
      return loadMemberById(db, orgAuth0Id, existing[0].id)
    }

    const created = await db<{ id: string }[]>`
      insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status, invited_by)
      values (${orgAuth0Id}, ${memberAuth0Id}, ${email}, ${input.role}, 'active', ${inviterAuth0Id})
      returning id;
    `
    if (!created?.[0]) return null
    return loadMemberById(db, orgAuth0Id, created[0].id)
  })
}

/**
 * Updates a member's role. Owner rows are immutable — returns null.
 */
export const setOrgMemberRole = async (
  orgAuth0Id: string,
  memberId: string,
  role: OrgMemberRole,
): Promise<OrgMember | null> => {
  return withHistoryStore(async (db) => {
    await ensureSchema(db)
    const target = await db<{ role: string }[]>`
      select role from org_members
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      limit 1;
    `
    if (!target?.[0] || target[0].role === "owner") return null
    const rows = await db<{ id: string }[]>`
      update org_members set role = ${role}, updated_at = now()
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      returning id;
    `
    if (!rows?.[0]) return null
    return loadMemberById(db, orgAuth0Id, memberId)
  })
}

/** Removes a member row. Returns false if it did not exist. */
export const removeOrgMember = async (
  orgAuth0Id: string,
  memberId: string,
): Promise<boolean> => {
  return (await withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<{ id: string }[]>`
      delete from org_members
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      returning id;
    `
    return Boolean(rows?.[0])
  })) ?? false
}