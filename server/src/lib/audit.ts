import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from "./supabaseHistory"

// ── Audit logs (§29) ─────────────────────────────────────────────────────────
// Append-only record of sensitive organizational actions. Writes are
// best-effort (a failed audit write must never fail the action itself).

export type AuditAction =
  | "member.invited"
  | "member.invite_accepted"
  | "member.invite_revoked"
  | "member.role_changed"
  | "member.removed"
  | "team.created"
  | "team.renamed"
  | "team.deleted"
  | "team.member_added"
  | "team.member_removed"
  | "analysis.deleted"

export const audit = async (entry: {
  orgAuth0Id: string
  actorAuth0Id: string | null
  action: AuditAction
  resourceType: string
  resourceId?: string | null
  result?: string | null
  meta?: Record<string, unknown> | null
  clientIp?: string | null
}): Promise<void> => {
  try {
    await withHistoryStore(async (db) => {
      await ensureInitialized()
      await db`
        create table if not exists audit_logs (
          id uuid primary key default gen_random_uuid(),
          org_auth0_id text not null,
          actor_auth0_id text,
          action text not null,
          resource_type text not null,
          resource_id text,
          result text,
          meta jsonb not null default '{}'::jsonb,
          client_ip text,
          created_at timestamptz not null default now()
        );
      `
      await db`
        create index if not exists idx_audit_logs_org_created
        on audit_logs (org_auth0_id, created_at desc);
      `
      await db`
        insert into audit_logs (
          org_auth0_id, actor_auth0_id, action, resource_type, resource_id,
          result, meta, client_ip
        ) values (
          ${entry.orgAuth0Id},
          ${entry.actorAuth0Id},
          ${entry.action},
          ${entry.resourceType},
          ${entry.resourceId ?? null},
          ${entry.result ?? "ok"},
          ${JSON.stringify(entry.meta ?? {})}::jsonb,
          ${entry.clientIp ?? null}
        );
      `
    })
  } catch (error) {
    console.error(JSON.stringify({
      type: "audit_write_failed",
      action: entry.action,
      error: error instanceof Error ? error.message : "unknown",
    }))
  }
}

export type AuditLog = {
  id: string
  org_auth0_id: string
  actor_auth0_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  result: string | null
  meta: Record<string, unknown>
  client_ip: string | null
  created_at: string
}

export const listAuditLogs = async (
  orgAuth0Id: string,
  limit = 50,
): Promise<AuditLog[]> => {
  const capped = Math.min(Math.max(limit, 1), 200)
  return (await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<AuditLog[]>`
      select id, org_auth0_id, actor_auth0_id, action, resource_type,
        resource_id, result, meta, client_ip, created_at
      from audit_logs
      where org_auth0_id = ${orgAuth0Id}
      order by created_at desc
      limit ${capped};
    `
    return rows ?? []
  })) ?? []
}
