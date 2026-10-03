// ── Request-scoped org-member role ────────────────────────────────────────────
// A leaf by construction, and that is the whole point: it exists so the service
// guard and `caller.ts` can share ONE membership lookup for a request without
// either importing the other.
//
// `caller.ts` already imports `SERVICE_HEADERS` from `serviceGuard.ts`, so a memo
// exported from either of those and read by the other is a cycle — and the
// recorded consequence of a guard that reaches back into the module it protects
// is a seam with no call sites. So the transport lives here instead: the only
// import is `orgMembers`, which imports only `historyStore`. Nothing below
// points back up.

import { getMemberRole, type OrgMemberRole } from './orgMembers'

const roleCache = new WeakMap<Request, Map<string, Promise<OrgMemberRole | null>>>()

/**
 * `getMemberRole`, memoised per request and per (org, member) pair.
 *
 * The global identity guard resolves the caller's org role on the way in, and the
 * handler's `resolveCaller` asks the same question with the SAME two arguments
 * moments later — with no shared cache that was two identical statements per
 * org request, both serial and both before any real work (measured: 4 serial
 * round trips of pure pre-work for an invited coach, where the org owner path
 * costs 0). The promise itself is cached, so a concurrent second caller joins
 * the flight in progress instead of starting one.
 *
 * Scoped to the Request object, never shared across requests, so a role change
 * or a revocation is visible on the very next request — a module-level or
 * connection-level cache would break that.
 *
 * Failures are NOT swallowed here: the returned promise rejects and each caller
 * applies its own policy and logs its own `member_role_lookup_failed` (the guard
 * with the path, `caller.ts` with the org), exactly as before. Only the
 * duplicate round trip is removed.
 */
export const memberRoleForRequest = (
  request: Request,
  orgAuth0Id: string,
  memberAuth0Id: string,
): Promise<OrgMemberRole | null> => {
  // NUL-joined so a pair can never be forged by a boundary: an org id and a
  // member id are both arbitrary strings off the wire, so any separator that can
  // appear *inside* an id can forge a collision — under a space, ("a b", "c") and
  // ("a", "b c") both yield "a b c" and would share a role. NUL cannot occur in a
  // URL or a header value, so it is the one separator that cannot be smuggled
  // across the boundary. Written as the escape `\0` rather than a raw NUL byte:
  // same character at runtime, but a raw byte makes grep classify this file as
  // binary and hides every match in it.
  const key = `${orgAuth0Id}\0${memberAuth0Id}`
  const cached = roleCache.get(request)?.get(key)
  if (cached) return cached
  const pending = getMemberRole(orgAuth0Id, memberAuth0Id)
  let byKey = roleCache.get(request)
  if (!byKey) {
    byKey = new Map()
    roleCache.set(request, byKey)
  }
  byKey.set(key, pending)
  return pending
}

/**
 * Test seam: forget one request's memoized roles. Not needed in production —
 * the WeakMap entry dies with the Request — but a test that swaps the identity
 * module underneath one Request object would otherwise keep answering from the
 * first lookup.
 */
export const forgetMemberRolesForTests = (request: Request): void => {
  roleCache.delete(request)
}
