import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import {
  ORG_MANAGER_ROLES,
  ORG_MEMBER_INVITE_ROLES,
  ORG_MEMBER_ROLES,
  ORG_STAFF_ROLES,
  ensureOrgOwner,
  getOrgMember,
  inviteOrgMember,
  listOrgMembers,
  removeOrgMember,
  setOrgMemberGrants,
  setOrgMemberRole,
  type OrgMemberInviteRole,
  type OrgMemberRole,
} from '../lib/orgMembers'
import { orgRoleGuard, serviceGuard } from '../lib/serviceGuard'
import { listInvites, mintInvite, revokeInvite } from '../lib/invites'
import { listAuditLogs } from '../lib/audit'
import { GRANTS, type Grant } from '../lib/permissions'
import { EMAIL_RE, UUID_RE, auditOrg, authorizeOrg } from '../lib/orgRoute'

// Org-member management routes. The identity (service) guard applies globally;
// role gates are applied per route group via orgRoleGuard on dedicated (sub-)
// apps so each group's scoped hook never leaks to sibling routes.

const INVITE_ROLE_SET: ReadonlySet<string> = new Set(ORG_MEMBER_INVITE_ROLES)
const ROLE_SET: ReadonlySet<string> = new Set(ORG_MEMBER_ROLES)

export default new Elysia()
  .use(serviceGuard)
  .use(
    new Elysia()
      .use(orgRoleGuard(ORG_STAFF_ROLES))
      .get('/api/org/:auth0Id/members', async ({ params, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        await ensureOrgOwner(auth0Id)
        const members = await listOrgMembers(auth0Id)
        const verifiedAuth0Id = request.headers.get('x-verified-auth0-id')
        const current =
          members.find((m) => m.member_auth0_id && m.member_auth0_id === verifiedAuth0Id) ??
          (verifiedAuth0Id === auth0Id ? { role: 'owner' as const } : null)
        set.status = 200
        return {
          members,
          roles: [...ORG_MEMBER_ROLES],
          current_user_role: current?.role ?? null,
        }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(ORG_MANAGER_ROLES))
      .post('/api/org/:auth0Id/members', async ({ params, body, request, set }) => {
        const { auth0Id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const { email, role } = (body ?? {}) as {
          email?: unknown
          role?: unknown
        }
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'A valid email is required', false)
        }
        if (typeof role !== 'string' || !INVITE_ROLE_SET.has(role)) {
          set.status = 400
          return buildError(
            'INVALID_REQUEST',
            `role must be one of ${[...INVITE_ROLE_SET].join(', ')}`,
            false,
          )
        }
        const auth = await authorizeOrg(request, auth0Id, 'org.invite', {
          inviteRole: role as OrgMemberRole,
        })
        if (!auth.ok) {
          set.status = auth.status
          return auth.body
        }
        const inviterAuth0Id = request.headers.get('x-verified-auth0-id') ?? auth0Id
        const member = await inviteOrgMember(auth0Id, inviterAuth0Id, {
          email: email as string,
          role: role as OrgMemberInviteRole,
        })
        if (!member) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Cannot invite the org owner', false)
        }
        audit(
          'member.invited',
          'org_member',
          member.id,
          {
            email: member.member_email,
            role: member.role,
            direct: true,
          },
          inviterAuth0Id,
        )
        set.status = 201
        return { member }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(ORG_MANAGER_ROLES))
      // Token-based invites (§7): mint a single-use link instead of adding
      // the row directly. The raw token is returned once for the invite
      // email; only its hash is stored.
      .post('/api/org/:auth0Id/invites', async ({ params, body, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const { email, role } = (body ?? {}) as {
          email?: unknown
          role?: unknown
        }
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'A valid email is required', false)
        }
        if (typeof role !== 'string' || !INVITE_ROLE_SET.has(role)) {
          set.status = 400
          return buildError(
            'INVALID_REQUEST',
            `role must be one of ${[...INVITE_ROLE_SET].join(', ')}`,
            false,
          )
        }
        const auth = await authorizeOrg(request, auth0Id, 'org.invite', {
          inviteRole: role as OrgMemberRole,
        })
        if (!auth.ok) {
          set.status = auth.status
          return auth.body
        }
        const createdBy = request.headers.get('x-verified-auth0-id') ?? auth0Id
        const minted = await mintInvite(auth0Id, createdBy, {
          email,
          role: role as OrgMemberInviteRole,
        })
        if (!minted) {
          set.status = 500
          return buildError('INTERNAL_ERROR', 'Could not create invitation', true)
        }
        set.status = 201
        return { invite: minted.invite, token: minted.token }
      })
      .get('/api/org/:auth0Id/invites', async ({ params, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        set.status = 200
        return { invites: await listInvites(auth0Id) }
      })
      .post('/api/org/:auth0Id/invites/:id/revoke', async ({ params, request, set }) => {
        const { auth0Id, id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !id || !UUID_RE.test(id)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid invite id', false)
        }
        const revoked = await revokeInvite(auth0Id, id)
        if (!revoked) {
          set.status = 404
          return buildError('NOT_FOUND', 'Invitation not found or already used', false)
        }
        audit('member.invite_revoked', 'org_invite', id)
        set.status = 200
        return { revoked: true }
      })
      .get('/api/org/:auth0Id/audit', async ({ params, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const auth = await authorizeOrg(request, auth0Id, 'org.audit')
        if (!auth.ok) {
          set.status = auth.status
          return auth.body
        }
        const url = new URL(request.url)
        const limitRaw = Number(url.searchParams.get('limit') || 50)
        const limit = Number.isFinite(limitRaw) ? limitRaw : 50
        set.status = 200
        return { logs: await listAuditLogs(auth0Id, limit) }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(['owner']))
      .patch('/api/org/:auth0Id/members/:id/role', async ({ params, body, request, set }) => {
        const { auth0Id, id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id or member id', false)
        }
        if (!UUID_RE.test(id)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid member id', false)
        }
        const { role } = (body ?? {}) as { role?: unknown }
        if (typeof role !== 'string' || !ROLE_SET.has(role) || role === 'owner') {
          set.status = 400
          return buildError(
            'INVALID_REQUEST',
            `role must be one of ${[...ROLE_SET].filter((r) => r !== 'owner').join(', ')} (ownership transfer is a separate action)`,
            false,
          )
        }
        const target = await getOrgMember(auth0Id, id)
        if (!target) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        if (target.role === 'owner') {
          set.status = 400
          return buildError('INVALID_REQUEST', "The owner's role cannot be changed", false)
        }
        const updated = await setOrgMemberRole(auth0Id, id, role as OrgMemberRole)
        if (!updated) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        audit('member.role_changed', 'org_member', id, {
          from: target.role,
          to: role,
        })
        set.status = 200
        return { member: updated }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(['owner']))
      // Permission flags on a person (e.g. medical.read, billing.view) — the
      // replacement for the old analyst/medical roles. Owner-granted, audited.
      .patch('/api/org/:auth0Id/members/:id/grants', async ({ params, body, request, set }) => {
        const { auth0Id, id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !id || !UUID_RE.test(id)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid member id', false)
        }
        const { grants } = (body ?? {}) as { grants?: unknown }
        if (!Array.isArray(grants) || grants.some((g) => typeof g !== 'string')) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'grants must be an array of strings', false)
        }
        const known: ReadonlySet<string> = new Set(GRANTS)
        const unknown = grants.filter((g) => !known.has(g as string))
        if (unknown.length > 0) {
          set.status = 400
          return buildError(
            'INVALID_REQUEST',
            `Unknown grant(s): ${unknown.join(', ')}. Allowed: ${GRANTS.join(', ')}`,
            false,
          )
        }
        const target = await getOrgMember(auth0Id, id)
        if (!target) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        const updated = await setOrgMemberGrants(auth0Id, id, grants as Grant[])
        if (!updated) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        audit('member.grants_changed', 'org_member', id, {
          from: target.grants,
          to: updated.grants,
        })
        set.status = 200
        return { member: updated }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(['owner']))
      .delete('/api/org/:auth0Id/members/:id', async ({ params, request, set }) => {
        const { auth0Id, id } = params
        const audit = auditOrg(request, auth0Id)
        if (!auth0Id || !id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id or member id', false)
        }
        if (!UUID_RE.test(id)) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Invalid member id', false)
        }
        const members = await listOrgMembers(auth0Id)
        const target = members.find((m) => m.id === id)
        if (!target) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        const ownerCount = members.filter((m) => m.role === 'owner').length
        if (target.role === 'owner' && ownerCount <= 1) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Cannot remove the last owner', false)
        }
        const removed = await removeOrgMember(auth0Id, id)
        if (!removed) {
          set.status = 404
          return buildError('NOT_FOUND', 'Member not found', false)
        }
        audit('member.removed', 'org_member', id, {
          email: target.member_email,
          role: target.role,
        })
        set.status = 200
        return { deleted: true }
      }),
  )
