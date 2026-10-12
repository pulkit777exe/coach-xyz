// ── Data transport ───────────────────────────────────────────────────────────
// Injected fetch/clock/id/XHR + single-sourced base URLs + the identity
// boundary. Every facade builds its URLs through these helpers instead of
// reading `process.env` or `IDENTITY_BASE` inline, so the capability base
// (direct backend), the identity base (proxy on the client, direct backend
// with service headers on the server), and the public base (share links)
// each resolve in exactly one place.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type XhrFactory = () => XMLHttpRequest

export type Transport = {
  fetchFn: FetchFn
  now: () => number
  randomId: () => string
  xhrFactory: XhrFactory
}

/**
 * Default transport over the ambient globals. `fetchFn`/`randomId` resolve
 * lazily at call time so test doubles installed via `vi.stubGlobal('fetch')`
 * keep working for the legacy `apiFetch` path.
 */
export function defaultTransport(): Transport {
  return {
    fetchFn: (url, init) => globalThis.fetch(url, init),
    now: () => Date.now(),
    randomId: () => globalThis.crypto.randomUUID(),
    xhrFactory: () => new globalThis.XMLHttpRequest(),
  }
}

/** Direct-backend base for capability routes (scan/analyze/status/chat). */
export function capabilityBase(): string | undefined {
  return process.env.NEXT_PUBLIC_API_URL
}

/**
 * Identity-bearing base: the same-origin proxy on the client (it verifies the
 * session and injects service headers), the backend directly on the server.
 */
export function identityBase(): string {
  return typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL as string)
    : '/api/service'
}

/** Identity base + an absolute path (e.g. `/api/auth/sync`). */
export function identityUrl(path: string): string {
  return `${identityBase()}${path}`
}

/** Capability base + an absolute path (e.g. `/api/scan-video`). */
export function capabilityUrl(path: string): string {
  return `${capabilityBase()}${path}`
}

/**
 * Public (unauthenticated) base + an absolute path. Share-link resolution is
 * NOT proxied through `/api/service` — `/api/share` is not an identity path —
 * so it resolves against the backend base explicitly rather than a raw
 * `process.env` read in the facade.
 */
export function publicUrl(path: string): string {
  return `${capabilityBase()}${path}`
}

export function orgUrl(auth0Id: string, path: string): string {
  return `${identityBase()}/api/org/${encodeURIComponent(auth0Id)}${path}`
}

// Email routes live under /api/email/:auth0Id/* (see server/src/routes/email.ts),
// NOT under /api/org/:auth0Id/email/* — keep them on the right namespace.
export function emailUrl(auth0Id: string, path: string): string {
  return `${identityBase()}/api/email/${encodeURIComponent(auth0Id)}${path}`
}

export function meUrl(path: string): string {
  return `${identityBase()}/api/me${path}`
}

export function authUserUrl(auth0Id: string, path = ''): string {
  return `${identityBase()}/api/auth/user/${encodeURIComponent(auth0Id)}${path}`
}

/** Headerless download path (attribution travels as `?attribution=`). */
export function downloadPath(jobId: string): string {
  return `/api/download/${jobId}`
}

export function identityFromRequest(url: string, body?: BodyInit | null): string | undefined {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // relative url — keep as-is
  }

  const scoped = path.match(/\/api\/(?:org|email|auth\/user)\/([^/]+)/)
  if (scoped) return decodeURIComponent(scoped[1])

  if (path.endsWith('/api/auth/sync') && typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { sub?: unknown }
      if (typeof parsed.sub === 'string') return parsed.sub
    } catch {
      // not JSON — the backend will reject it
    }
  }
  return undefined
}

/**
 * Server-side identity for identity-bearing calls. Never trust a path-scoped id
 * here: the backend authorizes the REAL caller, so the header must be the
 * session sub (the actual user), not the org id in the URL. Falls back to the
 * path-derived id only when no session is available (e.g. auth/sync during
 * onboarding, or non-request contexts).
 */
export async function serverIdentity(
  url: string,
  body?: BodyInit | null,
): Promise<string | undefined> {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // relative url — keep as-is
  }

  const isIdentityBearing =
    path.match(/\/api\/(?:org|email|auth\/user)\/[^/]+/) !== null ||
    path.startsWith('/api/me/') ||
    path.endsWith('/api/auth/sync')
  if (!isIdentityBearing) return undefined

  try {
    const { getSession } = await import('../session')
    const session = await getSession()
    const sub = session?.user?.sub
    if (sub) return sub
  } catch {
    // Not in a request context (tests, build-time) — fall through.
  }
  return identityFromRequest(url, body)
}

/**
 * Service headers for server-side identity-bearing calls (service token + the
 * session sub as the REAL caller). Empty client-side — the `/api/service`
 * proxy injects them from auth0 itself — and empty for capability routes.
 */
export async function serviceHeaders(
  url: string,
  body?: BodyInit | null,
): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {}
  const identity = await serverIdentity(url, body)
  if (!identity) return {}
  const headers: Record<string, string> = {}
  if (process.env.SERVICE_TOKEN) headers['x-service-token'] = process.env.SERVICE_TOKEN
  headers['x-verified-auth0-id'] = identity
  return headers
}
