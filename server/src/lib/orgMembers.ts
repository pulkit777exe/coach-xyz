import { SQL } from 'bun'

import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from './historyStore'

export const ORG_MEMBER_ROLES = ['owner', 'head_coach', 'junior_coach', 'player'] as const
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number]

export const ORG_STAFF_ROLES = ['owner', 'head_coach', 'junior_coach'] as const
export type OrgStaffRole = (typeof ORG_STAFF_ROLES)[number]

/** Roles that may manage/invite people (owner + head coach). */
export const ORG_MANAGER_ROLES = ['owner', 'head_coach'] as const

export const ORG_MEMBER_ROLE_LABELS: Record<OrgMemberRole, string> = {
  owner: 'Owner',
  head_coach: 'Head Coach',
  junior_coach: 'Junior Coach',
  player: 'Player',
}

export const ORG_MEMBER_INVITE_ROLES = ['head_coach', 'junior_coach', 'player'] as const
export type OrgMemberInviteRole = (typeof ORG_MEMBER_INVITE_ROLES)[number]

const LEGACY_ORG_ROLE_MAP: Record<string, OrgMemberRole> = {
  admin: 'head_coach',
  coach: 'head_coach',
  assistant_coach: 'junior_coach',
  analyst: 'junior_coach',
  medical: 'junior_coach',
}

export function canonicalizeOrgRole(role: string | null | undefined): OrgMemberRole | null {
  if (!role) return null
  if ((ORG_MEMBER_ROLES as readonly string[]).includes(role)) return role as OrgMemberRole
  return LEGACY_ORG_ROLE_MAP[role] ?? null
}

export type OrgMember = {
  id: string
  member_auth0_id: string | null
  member_email: string | null
  role: OrgMemberRole
  grants: string[]
  status: string
  display_name: string | null
  picture: string | null
  created_at: string
}

const MEMBER_SELECT_COLUMNS = `
  m.id,
  m.member_auth0_id,
  coalesce(m.member_email, u.email) as member_email,
  m.role,
  coalesce(m.grants, '{}') as grants,
  m.status,
  coalesce(u.name, u.nickname, m.member_email, u.email) as display_name,
  u.picture,
  m.created_at
`

type MemberRow = Omit<OrgMember, 'role' | 'grants'> & {
  role: string
  grants: unknown
}

const hydrateMember = (row: MemberRow): OrgMember => ({
  ...row,
  role: canonicalizeOrgRole(row.role) ?? 'player',
  grants: Array.isArray(row.grants) ? row.grants.filter((g): g is string => typeof g === 'string') : [],
})

const ensureSchema = async (db: SQL) => {
  await ensureInitialized()
  await db`
    create table if not exists org_members (
      id uuid primary key default gen_random_uuid(),
      org_auth0_id text not null,
      member_auth0_id text,
      member_email text,
      role text not null check (role in ('owner','head_coach','junior_coach','player')),
      grants text[] not null default '{}',
      status text not null default 'active',
      invited_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint org_members_unique unique (org_auth0_id, member_auth0_id)
    );
  `
  await db`alter table org_members add column if not exists grants text[] not null default '{}';`
  await db`
    do $$
    declare r record;
    begin
      for r in
        select conname
        from pg_constraint
        where conrelid = 'org_members'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%role%'
      loop
        execute format('alter table org_members drop constraint %I', r.conname);
      end loop;
    end
    $$;
  `
  await db`
    update org_members
    set grants = array_append(coalesce(grants, '{}'), 'medical.read')
    where role = 'medical'
      and not ('medical.read' = any(coalesce(grants, '{}')));
  `
  await db`
    update org_members set role = 'head_coach' where role in ('admin', 'coach');
  `
  await db`
    update org_members
    set role = 'junior_coach'
    where role in ('assistant_coach', 'analyst', 'medical');
  `
  await db`
    alter table org_members
      add constraint org_members_role_check
      check (role in ('owner','head_coach','junior_coach','player'));
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

export const ensureOrgMembersInitialized = async (): Promise<void> => {
  await withHistoryStore((db) => ensureSchema(db))
}

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
  const rows = await db<MemberRow[]>`
    select ${db.unsafe(MEMBER_SELECT_COLUMNS)}
    from org_members m
    left join users u on u.auth0_id = m.member_auth0_id
    where m.org_auth0_id = ${orgAuth0Id} and m.id = ${id}
    limit 1;
  `
  return rows?.[0] ? hydrateMember(rows[0]) : null
}

export const listOrgMembers = async (orgAuth0Id: string): Promise<OrgMember[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
      await db`
      insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status)
      select ${orgAuth0Id}, ${orgAuth0Id}, u.email, 'owner', 'active'
      from (select 1) src
      left join users u on u.auth0_id = ${orgAuth0Id}
      on conflict (org_auth0_id, member_auth0_id) do nothing;
    `
      const rows = await db<MemberRow[]>`
      select ${db.unsafe(MEMBER_SELECT_COLUMNS)}
      from org_members m
      left join users u on u.auth0_id = m.member_auth0_id
      where m.org_auth0_id = ${orgAuth0Id}
      order by
        case m.role
          when 'owner' then 0
          when 'head_coach' then 1
          when 'junior_coach' then 2
          else 3
        end,
        coalesce(u.name, m.member_email) asc nulls last;
    `
      return (rows ?? []).map(hydrateMember)
    })) ?? []
  )
}

export type OrgMembership = {
  org_auth0_id: string
  role: OrgMemberRole
  display_name: string | null
}

export const listMembershipsForUser = async (memberAuth0Id: string): Promise<OrgMembership[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
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
      return (rows ?? [])
        .map((row) => {
          const role = canonicalizeOrgRole(row.role)
          return role ? { ...row, role } : null
        })
        .filter((row): row is OrgMembership => row !== null)
    })) ?? []
  )
}

export const getOrgMember = async (orgAuth0Id: string, id: string): Promise<OrgMember | null> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
      return loadMemberById(db, orgAuth0Id, id)
    })) ?? null
  )
}

export const getMemberRole = async (
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<OrgMemberRole | null> => {
  const access = await getMemberAccess(orgAuth0Id, memberAuth0Id)
  return access?.role ?? null
}

export type MemberAccess = {
  role: OrgMemberRole
  grants: string[]
}

export const getMemberAccess = async (
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<MemberAccess | null> => {
  if (memberAuth0Id === orgAuth0Id) return { role: 'owner', grants: [] }
  return (
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
      const rows = await db<{ role: string; grants: unknown }[]>`
      select role, coalesce(grants, '{}') as grants from org_members
      where org_auth0_id = ${orgAuth0Id}
        and member_auth0_id = ${memberAuth0Id}
        and status = 'active'
      limit 1;
    `
      const row = rows?.[0]
      if (!row) return null
      const role = canonicalizeOrgRole(row.role)
      if (!role) return null
      return {
        role,
        grants: Array.isArray(row.grants)
          ? row.grants.filter((g): g is string => typeof g === 'string')
          : [],
      }
    })) ?? null
  )
}

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
    if (!target?.[0]) return null
    const current = canonicalizeOrgRole(target[0].role)
    if (current === 'owner' && role !== 'owner') {
      const owners = await db<{ n: number }[]>`
        select count(*)::int as n from org_members
        where org_auth0_id = ${orgAuth0Id} and role = 'owner' and status = 'active';
      `
      if ((owners?.[0]?.n ?? 0) <= 1) return null
    }
    const rows = await db<{ id: string }[]>`
      update org_members set role = ${role}, updated_at = now()
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      returning id;
    `
    if (!rows?.[0]) return null
    return loadMemberById(db, orgAuth0Id, memberId)
  })
}

export const setOrgMemberGrants = async (
  orgAuth0Id: string,
  memberId: string,
  grants: readonly string[],
): Promise<OrgMember | null> => {
  const unique = [...new Set(grants)]
  return withHistoryStore(async (db) => {
    await ensureSchema(db)
    const rows = await db<{ id: string }[]>`
      update org_members set grants = ${unique}::text[], updated_at = now()
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      returning id;
    `
    if (!rows?.[0]) return null
    return loadMemberById(db, orgAuth0Id, memberId)
  })
}

export const removeOrgMember = async (orgAuth0Id: string, memberId: string): Promise<boolean> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureSchema(db)
      const rows = await db<{ id: string }[]>`
      delete from org_members
      where org_auth0_id = ${orgAuth0Id} and id = ${memberId}
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
