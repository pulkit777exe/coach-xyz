import { Elysia } from "elysia"
import { buildError } from "./errors"
import { getMemberRole, listOrgMembers } from "./orgMembers"
import type { OrgMemberRole } from "./orgMembers"
import { timingSafeEqual } from "node:crypto"

// ── Service-to-service identity guard ────────────────────────────────────────
// The web app (Next.js) sits between the browser and this server. The proxy
// injects HEADERS.serviceToken (shared secret) and HEADERS.verifiedAuth0Id
// (the session's verified Auth0 sub). Identity-bearing routes must never trust
// the auth0Id in the path/body alone — this guard enforces that, so a logged-in
// caller cannot read or modify another account's data.
//
// When process.env.SERVICE_TOKEN is **unset**, the guard is inert so local
// development (web pointed straight at the server) keeps working.

export const SERVICE_HEADERS = {
  token: "x-service-token",
  verifiedAuth0Id: "x-verified-auth0-id",
} as const

export function serviceGuardEnabled(): boolean {
  return Boolean(process.env.SERVICE_TOKEN)
}

let warnedAboutDisabledGuard = false
function maybeLogDisabled() {
  if (serviceGuardEnabled() || warnedAboutDisabledGuard) return
  warnedAboutDisabledGuard = true
  console.warn(
    JSON.stringify({
      type: "service_guard_disabled",
      message:
        "SERVICE_TOKEN not set — browser is expected to call this server directly. Set it on both server and web app to enforce the identity boundary.",
      timestamp: new Date().toISOString(),
    }),
  )
}

export type ServiceIdentityCheck =
  | { ok: true }
  | { ok: false; status: 403; body: ReturnType<typeof buildError> }

/**
 * Verifies a request's service headers against the resource owner's auth0Id.
 * Returns `{ ok: true }` when the guard is disabled or the request is legit.
 *
 * `self` routes (/api/me/*) carry no auth0Id in path or body — the verified id
 * is the resource owner by definition, so a present verified id suffices.
 *
 * `memberRole` (from getMemberRole) authorizes a caller who is not the resource
 * owner but holds an ACTIVE org membership for the org named by the resource id
 * (multi-coach data access). It is only meaningful on org-scoped paths, so
 * callers must derive it via getMemberRole for /api/org|email/:id and
 * /api/auth/user/:id — never trust a raw memberRole from the wire.
 */
export function verifyServiceIdentity(
  token: string | null,
  verifiedAuth0Id: string | null,
  resourceAuth0Id: string | null | undefined,
  opts: { self?: boolean; memberRole?: OrgMemberRole | null } = {},
): ServiceIdentityCheck {
  if (!serviceGuardEnabled()) {
    maybeLogDisabled()
    return { ok: true }
  }

  if (!token || !process.env.SERVICE_TOKEN || token !== process.env.SERVICE_TOKEN) {
    let tokenOk = false
    try {
      tokenOk =
        token !== null &&
        process.env.SERVICE_TOKEN !== undefined &&
        timingSafeEqual(Buffer.from(token), Buffer.from(process.env.SERVICE_TOKEN))
    } catch {
      tokenOk = false
    }
    if (!tokenOk) {
      return {
        ok: false,
        status: 403,
        body: buildError("FORBIDDEN", "Invalid service credentials", false),
      }
    }
  }

  if (!verifiedAuth0Id) {
    return {
      ok: false,
      status: 403,
      body: buildError("FORBIDDEN", "Missing verified identity", false),
    }
  }

  if (opts.self) return { ok: true }

  if (!resourceAuth0Id) {
    return {
      ok: false,
      status: 403,
      body: buildError("FORBIDDEN", "Missing requested account", false),
    }
  }

  if (verifiedAuth0Id === resourceAuth0Id || opts.memberRole) return { ok: true }

  return {
    ok: false,
    status: 403,
    body: buildError(
      "FORBIDDEN",
      "Authenticated identity does not match the requested account",
      false,
    ),
  }
}

/** True for identity-bearing paths whose resource id names an ORG (not a self route). */
function isOrgScopedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/org/") ||
    pathname.startsWith("/api/email/") ||
    pathname.startsWith("/api/auth/user/")
  )
}

export async function resolveMemberRoleForPath(
  pathname: string,
  orgAuth0Id: string,
  verifiedAuth0Id: string,
): Promise<OrgMemberRole | null> {
  if (!isOrgScopedPath(pathname) || !orgAuth0Id || orgAuth0Id === verifiedAuth0Id) return null
  try {
    return await getMemberRole(orgAuth0Id, verifiedAuth0Id)
  } catch {
    // DB unavailable — deny by treating the caller as a non-member.
    return null
  }
}

export type OrgRoleCheck =
  | { ok: true }
  | { ok: false; status: 403; body: ReturnType<typeof buildError> }

export type OrgRoleMember = {
  member_auth0_id: string | null
  role: OrgMemberRole
}

/**
 * Pure decision rule for the org-membership role guard. `members` is the org's
 * member list (documents the org_members rows; passed in so this stays testable
 * without a DB). Access is granted when:
 *  - the service guard is disabled (SERVICE_TOKEN unset — local dev), OR
 *  - the caller has an org_members row for this org with a role in
 *    `requiredRoles`, OR
 *  - the caller owns the org (verifiedAuth0Id === orgAuth0Id) and "owner" is in
 *    `requiredRoles` — owner rows are lazily seeded on first read, so the owner
 *    must pass even before their org_members row exists.
 * Everything else is denied with 403.
 */
export function verifyOrgRole(opts: {
  verifiedAuth0Id: string | null
  orgAuth0Id: string
  requiredRoles: readonly OrgMemberRole[]
  members: OrgRoleMember[] | null
}): OrgRoleCheck {
  const { verifiedAuth0Id, orgAuth0Id, requiredRoles, members } = opts

  if (!serviceGuardEnabled()) {
    maybeLogDisabled()
    return { ok: true }
  }

  if (!verifiedAuth0Id) {
    return {
      ok: false,
      status: 403,
      body: buildError("FORBIDDEN", "Missing verified identity", false),
    }
  }

  const callerRole = members?.find(
    (m) => m.member_auth0_id && m.member_auth0_id === verifiedAuth0Id,
  )?.role
  if (callerRole && requiredRoles.includes(callerRole)) return { ok: true }

  if (verifiedAuth0Id === orgAuth0Id && requiredRoles.includes("owner")) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 403,
    body: buildError("FORBIDDEN", "Insufficient role for this organization", false),
  }
}

/**
 * Elysia plugin scoping org-member routes to callers holding at least one of
 * `requiredRoles` on the org named by `params.auth0Id`. Compose it on dedicated
 * (sub-)app route groups — scoped hooks are captured by the instance they are
 * declared on, so mounting one plugin per role group keeps routes isolated.
 */
export const orgRoleGuard = (requiredRoles: readonly OrgMemberRole[]) =>
  new Elysia({ name: `orgRoleGuard:${requiredRoles.join("|")}` }).onBeforeHandle(
    { as: "scoped" },
    async ({ request, params, set }) => {
      if (!serviceGuardEnabled()) {
        maybeLogDisabled()
        return
      }
      const auth0Id =
        typeof (params as Record<string, unknown>)?.auth0Id === "string"
          ? ((params as Record<string, unknown>).auth0Id as string)
          : undefined
      if (!auth0Id) {
        set.status = 400
        return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
      }
      const verifiedAuth0Id = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
      let members: OrgRoleMember[] | null = null
      try {
        members = await listOrgMembers(auth0Id)
      } catch {
        // DB unavailable — fail the check below on empty membership.
      }
      const outcome = verifyOrgRole({
        verifiedAuth0Id,
        orgAuth0Id: auth0Id,
        requiredRoles,
        members,
      })
      if (!outcome.ok) {
        set.status = outcome.status
        return outcome.body
      }
    },
  )

const isSelfPath = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname
    return pathname.startsWith("/api/me")
  } catch {
    return false
  }
}

/**
 * Elysia plugin for identity-bearing route trees. For path-scoped routes the
 * resource owner is `params.auth0Id` (e.g. /api/org/:auth0Id/...); for the
 * onboarding sync route it is `body.sub`.
 */
export const serviceGuard = new Elysia({ name: "serviceGuard" }).onBeforeHandle(
  { as: "global" },
  async ({ request, params, body, set }) => {
    if (!serviceGuardEnabled()) {
      maybeLogDisabled()
      return
    }

    const pathAuth0Id =
      typeof (params as Record<string, unknown>)?.auth0Id === "string"
        ? ((params as Record<string, unknown>).auth0Id as string)
        : undefined
    const bodyAuth0Id =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).sub === "string"
        ? ((body as Record<string, unknown>).sub as string)
        : undefined
    const resourceAuth0Id = pathAuth0Id ?? bodyAuth0Id

    const verifiedAuth0Id = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    const memberRole =
      resourceAuth0Id && verifiedAuth0Id
        ? await resolveMemberRoleForPath(request.url, resourceAuth0Id, verifiedAuth0Id)
        : null

    const outcome = verifyServiceIdentity(
      request.headers.get(SERVICE_HEADERS.token),
      verifiedAuth0Id,
      resourceAuth0Id,
      {
        self: isSelfPath(request.url),
        memberRole,
      },
    )
    if (!outcome.ok) {
      set.status = outcome.status
      return outcome.body
    }
  },
)