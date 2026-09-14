import { Elysia } from "elysia"
import { buildError } from "./errors"

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
 */
export function verifyServiceIdentity(
  token: string | null,
  verifiedAuth0Id: string | null,
  resourceAuth0Id: string | null | undefined,
  opts: { self?: boolean } = {},
): ServiceIdentityCheck {
  if (!serviceGuardEnabled()) {
    maybeLogDisabled()
    return { ok: true }
  }

  if (!token || !process.env.SERVICE_TOKEN || token !== process.env.SERVICE_TOKEN) {
    return {
      ok: false,
      status: 403,
      body: buildError("FORBIDDEN", "Invalid service credentials", false),
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

  if (!resourceAuth0Id || verifiedAuth0Id !== resourceAuth0Id) {
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

  return { ok: true }
}

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
  ({ request, params, body, set }) => {
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

    const outcome = verifyServiceIdentity(
      request.headers.get(SERVICE_HEADERS.token),
      request.headers.get(SERVICE_HEADERS.verifiedAuth0Id),
      resourceAuth0Id,
      { self: isSelfPath(request.url) },
    )
    if (!outcome.ok) {
      set.status = outcome.status
      return outcome.body
    }
  },
)