// ── Org route kernel ─────────────────────────────────────────────────────────
// One home for the small chains every org/member/team/email route repeats:
// UUID + email validators, the org-role forbid, and the audit binder.
// Deliberately NOT a param-presence helper (Elysia params are always
// defined on matched routes — wrapping those guards adds lines), and NOT
// guard topology (serviceGuard + orgRoleGuard composition per route is a
// security decision, not boilerplate).

import { auditRoute, type AuditAction } from './audit'
import { buildError } from './errors'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value)

export const isEmail = (value: unknown): value is string =>
  typeof value === 'string' && EMAIL_RE.test(value)

export type OrgRouteSet = { status?: number | string }

export const forbidOrg = (
  set: OrgRouteSet,
  message = 'Insufficient role for this organization',
) => {
  set.status = 403
  return buildError('FORBIDDEN', message, false)
}

/** Bound audit writer: `audit('member.invited', 'org_member', id, meta)`. */
export const auditOrg = (request: Request, orgAuth0Id: string) => {
  return (
    action: AuditAction,
    entity: string,
    id?: string | null,
    meta?: Record<string, unknown> | null,
    actorOverride?: string | null,
  ): void => {
    auditRoute(request, orgAuth0Id, action, entity, id, meta, actorOverride)
  }
}
