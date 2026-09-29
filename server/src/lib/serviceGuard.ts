import { Elysia } from 'elysia'
import { buildError } from './errors'
import { getMemberRole, listOrgMembers } from './orgMembers'
import type { OrgMemberRole } from './orgMembers'
import { timingSafeEqual } from 'node:crypto'
import { logger } from './logger'

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
  token: 'x-service-token',
  verifiedAuth0Id: 'x-verified-auth0-id',
} as const

export function serviceGuardEnabled(): boolean {
  return Boolean(process.env.SERVICE_TOKEN)
}

let warnedAboutDisabledGuard = false
function maybeLogDisabled() {
  if (serviceGuardEnabled() || warnedAboutDisabledGuard) return
  warnedAboutDisabledGuard = true
  logger.warn('service_guard_disabled', {
    type: 'service_guard_disabled',
    detail:
      'SERVICE_TOKEN not set — browser is expected to call this server directly. Set it on both server and web app to enforce the identity boundary.',
  })
}

export type ServiceIdentityCheck =
  { ok: true } | { ok: false; status: 403; body: ReturnType<typeof buildError> }

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
  opts: {
    self?: boolean
    memberRole?: OrgMemberRole | null
    allowedMemberRoles?: readonly OrgMemberRole[]
  } = {},
): ServiceIdentityCheck {
  if (!serviceGuardEnabled()) {
    maybeLogDisabled()
    return { ok: true }
  }

  // Constant-time token compare — never short-circuit on a mismatch.
  const expected = process.env.SERVICE_TOKEN
  let tokenOk = false
  if (token && expected) {
    try {
      tokenOk = timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    } catch {
      // Buffer length mismatch throws — treat as non-match.
      tokenOk = false
    }
  }
  if (!tokenOk) {
    return {
      ok: false,
      status: 403,
      body: buildError('FORBIDDEN', 'Invalid service credentials', false),
    }
  }

  if (!verifiedAuth0Id) {
    return {
      ok: false,
      status: 403,
      body: buildError('FORBIDDEN', 'Missing verified identity', false),
    }
  }

  if (opts.self) return { ok: true }

  if (!resourceAuth0Id) {
    return {
      ok: false,
      status: 403,
      body: buildError('FORBIDDEN', 'Missing requested account', false),
    }
  }

  if (verifiedAuth0Id === resourceAuth0Id) return { ok: true }

  // Cross-account access via org membership. Some trees (notably
  // /api/auth/user/*, where the resource id is the coach's own account and the
  // rows include full summaries) must not grant player-role members read
  // access to another account — restrict those trees via allowedMemberRoles.
  if (
    opts.memberRole &&
    (!opts.allowedMemberRoles || opts.allowedMemberRoles.includes(opts.memberRole))
  ) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 403,
    body: buildError(
      'FORBIDDEN',
      'Authenticated identity does not match the requested account',
      false,
    ),
  }
}

/** True for identity-bearing paths whose resource id names an ORG (not a self
 *  route). Accepts either a pathname or an absolute request URL — the global
 *  guard calls resolveMemberRoleForPath with request.url, so normalize first
 *  (mirrors isSelfPath below); a bare pathname passes through the catch. */
export function isOrgScopedPath(pathnameOrUrl: string): boolean {
  let pathname = pathnameOrUrl
  try {
    pathname = new URL(pathnameOrUrl).pathname
  } catch {
    // Not a URL — already a pathname.
  }
  return (
    pathname.startsWith('/api/org/') ||
    pathname.startsWith('/api/email/') ||
    pathname.startsWith('/api/auth/user/')
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
  } catch (error) {
    // DB unavailable — deny by treating the caller as a non-member. Failing
    // closed is right; failing *silently* is not. `caller.ts` logs the identical
    // failure class as member_role_lookup_failed, so a Neon blip here denied
    // every non-owner org request with zero signal.
    logger.warn('member_role_lookup_failed', {
      type: 'member_role_lookup_failed',
      path: pathname,
      orgAuth0Id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export type OrgRoleCheck =
  { ok: true } | { ok: false; status: 403; body: ReturnType<typeof buildError> }

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
      body: buildError('FORBIDDEN', 'Missing verified identity', false),
    }
  }

  const callerRole = members?.find(
    (m) => m.member_auth0_id && m.member_auth0_id === verifiedAuth0Id,
  )?.role
  if (callerRole && requiredRoles.includes(callerRole)) return { ok: true }

  if (verifiedAuth0Id === orgAuth0Id && requiredRoles.includes('owner')) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 403,
    body: buildError('FORBIDDEN', 'Insufficient role for this organization', false),
  }
}

/**
 * Elysia plugin scoping org-member routes to callers holding at least one of
 * `requiredRoles` on the org named by `params.auth0Id`. Compose it on dedicated
 * (sub-)app route groups — scoped hooks are captured by the instance they are
 * declared on, so mounting one plugin per role group keeps routes isolated.
 */
export const orgRoleGuard = (requiredRoles: readonly OrgMemberRole[]) =>
  new Elysia({
    name: `orgRoleGuard:${requiredRoles.join('|')}`,
  }).onBeforeHandle({ as: 'scoped' }, async ({ request, params, set }) => {
    if (!serviceGuardEnabled()) {
      maybeLogDisabled()
      return
    }
    const auth0Id =
      typeof (params as Record<string, unknown>)?.auth0Id === 'string'
        ? ((params as Record<string, unknown>).auth0Id as string)
        : undefined
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const verifiedAuth0Id = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    // Owner fast-path: the org owner always holds the owner role (rows are
    // lazily seeded), so skip the member-list DB round-trip entirely.
    if (verifiedAuth0Id === auth0Id && requiredRoles.includes('owner')) {
      return
    }
    let members: OrgRoleMember[] | null = null
    try {
      members = await listOrgMembers(auth0Id)
    } catch (error) {
      // DB unavailable — fail the check below on empty membership. As above, the
      // fail-closed default is correct and the silence was not: a transient
      // database error looked exactly like "this caller holds no role here".
      logger.warn('org_role_lookup_failed', {
        type: 'org_role_lookup_failed',
        orgAuth0Id: auth0Id,
        requiredRoles,
        error: error instanceof Error ? error.message : String(error),
      })
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
  })

/** Roles allowed cross-account access on /api/auth/user/* trees. The resource
 * id is the coach's own account (analyses carry full summary_json), so
 * player- and medical-role members must not read another account's dashboard
 * — players use self-scoped /api/me/* instead. Analysts are in: analysis is
 * their job. */
export const AUTH_USER_ALLOWED_MEMBER_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
  'analyst',
]

const isAuthUserPath = (url: string): boolean => {
  try {
    return new URL(url).pathname.startsWith('/api/auth/user/')
  } catch {
    return false
  }
}

const isSelfPath = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname
    return pathname.startsWith('/api/me')
  } catch {
    return false
  }
}

/**
 * The public share-link resolve: unauthenticated by design (the token is the
 * credential — link readers need no login). It must bypass the global guard
 * entirely: `serviceGuard` is `as: 'global'`, so mounting the guarded
 * orgShareRoute also guards its sibling publicShareRoute, and every public
 * link 403'd in production while working locally with the guard inert.
 * Single-segment only — nothing else under /api/share exists.
 */
export function isPublicSharePath(pathnameOrUrl: string): boolean {
  let pathname = pathnameOrUrl
  try {
    pathname = new URL(pathnameOrUrl).pathname
  } catch {
    // Not a URL — already a pathname.
  }
  return /^\/api\/share\/[^/]+$/.test(pathname)
}

/** The onboarding sync route names its owner in `body.sub` (no path id). */
export function isAuthSyncPath(pathnameOrUrl: string): boolean {
  let pathname = pathnameOrUrl
  try {
    pathname = new URL(pathnameOrUrl).pathname
  } catch {
    // Not a URL — already a pathname.
  }
  return pathname === '/api/auth/sync'
}

/**
 * Elysia plugin for identity-bearing route trees. For path-scoped routes the
 * resource owner is `params.auth0Id` (e.g. /api/org/:auth0Id/...).
 *
 * The hook deliberately does NOT destructure Elysia's `body`: doing so forces
 * a global body parse that consumes the request stream, so every handler
 * reading it itself (`request.json()` / `request.formData()`) throws "Body
 * already used" in the composed app — while standalone route mounts (most
 * unit tests) pass. That took out scan-video upload, both analyze kickoffs,
 * and invite-accept in production. The one route naming its owner in the
 * body (POST /api/auth/sync, `body.sub`) enforces identity in its own
 * handler via verifyServiceIdentity; the guard skips it here.
 */
export const serviceGuard = new Elysia({ name: 'serviceGuard' }).onBeforeHandle(
  { as: 'global' },
  async ({ request, params, set }) => {
    if (!serviceGuardEnabled()) {
      maybeLogDisabled()
      return
    }

    // Public share links carry no identity at all (see isPublicSharePath).
    if (isPublicSharePath(request.url)) return

    // Onboarding sync names its owner in body.sub — enforced in the handler
    // (verifyServiceIdentity), which owns the parsed body. The global hook
    // cannot read it without consuming the stream (see above).
    if (isAuthSyncPath(request.url)) return

    const pathAuth0Id =
      typeof (params as Record<string, unknown>)?.auth0Id === 'string'
        ? ((params as Record<string, unknown>).auth0Id as string)
        : undefined
    const resourceAuth0Id = pathAuth0Id

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
        allowedMemberRoles: isAuthUserPath(request.url)
          ? AUTH_USER_ALLOWED_MEMBER_ROLES
          : undefined,
      },
    )
    if (!outcome.ok) {
      set.status = outcome.status
      return outcome.body
    }
  },
)
