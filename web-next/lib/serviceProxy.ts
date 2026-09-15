// Pure helpers for the identity proxy route handler. Kept framework-free so
// they can be unit-tested without spinning up Next.

/**
 * /api/org/:auth0Id/...   → ["api", "org", :auth0Id, ...]
 * /api/auth/user/:auth0Id/... → ["api", "auth", "user", :auth0Id, ...]
 * /api/email/:auth0Id/... → ["api", "email", :auth0Id, ...]
 */
export function resourceAuth0Id(path: string[]): string | undefined {
  if (path.length >= 3 && path[0] === "api" && path[1] === "org") return path[2]
  if (path.length >= 3 && path[0] === "api" && path[1] === "email") return path[2]
  if (path.length >= 4 && path[0] === "api" && path[1] === "auth" && path[2] === "user") {
    return path[3]
  }
  return undefined
}

/**
 * Self-scoped routes (/api/me/*) carry no auth0Id in the path — the verified
 * session identity is the resource owner by definition.
 */
export function isSelfPath(path: string[]): boolean {
  return path.length >= 2 && path[0] === "api" && path[1] === "me"
}

/** /api/auth/sync has no path-scoped id — identity comes from body.sub. */
export function isIdentityPath(path: string[]): boolean {
  const syncMatch =
    path.length === 3 && path[0] === "api" && path[1] === "auth" && path[2] === "sync"
  return syncMatch || resourceAuth0Id(path) !== undefined || isSelfPath(path)
}

/** Decode a percent-encoded identity path. */
export function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}