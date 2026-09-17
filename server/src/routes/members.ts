import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import {
  ORG_MEMBER_INVITE_ROLES,
  ORG_MEMBER_ROLES,
  ensureOrgOwner,
  getOrgMember,
  inviteOrgMember,
  listOrgMembers,
  removeOrgMember,
  setOrgMemberRole,
  type OrgMemberInviteRole,
  type OrgMemberRole,
} from "../lib/orgMembers"
import { orgRoleGuard, serviceGuard } from "../lib/serviceGuard"

// Org-member management routes. The identity (service) guard applies globally;
// role gates are applied per route group via orgRoleGuard on dedicated (sub-)
// apps so each group's scoped hook never leaks to sibling routes.

const INVITE_ROLE_SET: ReadonlySet<string> = new Set(ORG_MEMBER_INVITE_ROLES)
const ROLE_SET: ReadonlySet<string> = new Set(ORG_MEMBER_ROLES)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default new Elysia()
  .use(serviceGuard)
  .use(
    new Elysia()
      .use(orgRoleGuard(ORG_MEMBER_ROLES))
      .get("/api/org/:auth0Id/members", async ({ params, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
        }
        await ensureOrgOwner(auth0Id)
        const members = await listOrgMembers(auth0Id)
        const verifiedAuth0Id = request.headers.get("x-verified-auth0-id")
        const current =
          members.find((m) => m.member_auth0_id && m.member_auth0_id === verifiedAuth0Id) ??
          (verifiedAuth0Id === auth0Id ? { role: "owner" as const } : null)
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
      .use(orgRoleGuard(["owner", "admin"]))
      .post("/api/org/:auth0Id/members", async ({ params, body, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
        }
        const { email, role } = (body ?? {}) as { email?: unknown; role?: unknown }
        if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
          set.status = 400
          return buildError("INVALID_REQUEST", "A valid email is required", false)
        }
        if (typeof role !== "string" || !INVITE_ROLE_SET.has(role)) {
          set.status = 400
          return buildError(
            "INVALID_REQUEST",
            `role must be one of ${[...INVITE_ROLE_SET].join(", ")}`,
            false,
          )
        }
        const inviterAuth0Id = request.headers.get("x-verified-auth0-id") ?? auth0Id
        const member = await inviteOrgMember(auth0Id, inviterAuth0Id, {
          email: email as string,
          role: role as OrgMemberInviteRole,
        })
        if (!member) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Cannot invite the org owner", false)
        }
        set.status = 201
        return { member }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(["owner"]))
      .patch("/api/org/:auth0Id/members/:id/role", async ({ params, body, set }) => {
        const { auth0Id, id } = params
        if (!auth0Id || !id) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Missing auth0Id or member id", false)
        }
        if (!UUID_RE.test(id)) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Invalid member id", false)
        }
        const { role } = (body ?? {}) as { role?: unknown }
        if (typeof role !== "string" || !ROLE_SET.has(role)) {
          set.status = 400
          return buildError(
            "INVALID_REQUEST",
            `role must be one of ${[...ROLE_SET].join(", ")}`,
            false,
          )
        }
        const target = await getOrgMember(auth0Id, id)
        if (!target) {
          set.status = 404
          return buildError("NOT_FOUND", "Member not found", false)
        }
        if (target.role === "owner") {
          set.status = 400
          return buildError("INVALID_REQUEST", "The owner's role cannot be changed", false)
        }
        const updated = await setOrgMemberRole(auth0Id, id, role as OrgMemberRole)
        if (!updated) {
          set.status = 404
          return buildError("NOT_FOUND", "Member not found", false)
        }
        set.status = 200
        return { member: updated }
      }),
  )
  .use(
    new Elysia()
      .use(orgRoleGuard(["owner"]))
      .delete("/api/org/:auth0Id/members/:id", async ({ params, set }) => {
        const { auth0Id, id } = params
        if (!auth0Id || !id) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Missing auth0Id or member id", false)
        }
        if (!UUID_RE.test(id)) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Invalid member id", false)
        }
        const members = await listOrgMembers(auth0Id)
        const target = members.find((m) => m.id === id)
        if (!target) {
          set.status = 404
          return buildError("NOT_FOUND", "Member not found", false)
        }
        const ownerCount = members.filter((m) => m.role === "owner").length
        if (target.role === "owner" && ownerCount <= 1) {
          set.status = 400
          return buildError("INVALID_REQUEST", "Cannot remove the last owner", false)
        }
        const removed = await removeOrgMember(auth0Id, id)
        if (!removed) {
          set.status = 404
          return buildError("NOT_FOUND", "Member not found", false)
        }
        set.status = 200
        return { deleted: true }
      }),
  )