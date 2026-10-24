import {
  withHistoryStoreOrThrow as withHistoryStore,
  ensureInitialized,
} from './historyStore'
import { SERVICE_HEADERS } from './serviceGuard'
import { readRequestMeta } from './requestMeta'

// ── Audit logs (§29) ─────────────────────────────────────────────────────────
// Append-only record of sensitive organizational actions. Writes are
// best-effort (a failed audit write must never fail the action itself).

export type AuditAction =
  | 'member.invited'
  | 'member.invite_accepted'
  | 'member.invite_revoked'
  | 'member.role_changed'
  | 'member.grants_changed'
  | 'member.removed'
  | 'ownership.transferred'
  | 'team.created'
  | 'team.renamed'
  | 'team.deleted'
  | 'team.member_added'
  | 'team.member_removed'
  | 'analysis.cancelled'
  | 'analysis.deleted'
  | 'video.exported'
  | 'video.viewed'
  | 'report.exported'
  | 'settings.changed'
  | 'player.created'
  | 'player.transferred'
  | 'health.record_viewed'
  | 'clip.created'
  | 'clip.deleted'

/**
 * All audit actions in display order. The web audit filter
 * (`web-next/components/org/AuditClient.tsx` ACTION_GROUPS) mirrors this
 * list — update both when adding an action.
 */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'member.invited',
  'member.invite_accepted',
  'member.invite_revoked',
  'member.role_changed',
  'member.removed',
  'team.created',
  'team.renamed',
  'team.deleted',
  'team.member_added',
  'team.member_removed',
  'analysis.cancelled',
  'analysis.deleted',
  'video.exported',
  'video.viewed',
  'report.exported',
  'settings.changed',
  'player.created',
  'player.transferred',
  'health.record_viewed',
  'clip.created',
  'clip.deleted',
]

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
      // Schema lives in ensureInitialized (historyStore.ts); this only writes.
      await ensureInitialized()
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
          ${entry.result ?? 'ok'},
          ${JSON.stringify(entry.meta ?? {})}::jsonb,
          ${entry.clientIp ?? null}
        );
      `
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'audit_write_failed',
        action: entry.action,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    )
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

/**
 * Audit a route action with request-derived context. The actor sub and
 * client IP come from the request itself, so call sites pass only what
 * they know: the org, the action, and the resource.
 */
export const auditRoute = (
  request: Request,
  orgAuth0Id: string,
  action: AuditAction,
  resourceType: string,
  resourceId?: string | null,
  meta?: Record<string, unknown> | null,
  actorOverride?: string | null,
): void => {
  const actor =
    actorOverride !== undefined
      ? actorOverride
      : request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
  void audit({
    orgAuth0Id,
    actorAuth0Id: actor,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    meta: meta ?? null,
    clientIp: readRequestMeta(request).clientIp,
  })
}

export const listAuditLogs = async (orgAuth0Id: string, limit = 50): Promise<AuditLog[]> => {
  const capped = Math.min(Math.max(limit, 1), 200)
  return (
    (await withHistoryStore(async (db) => {
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
  )
}
