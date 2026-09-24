import { ORG_COOKIE } from './orgCookie'

export type OrgRole =
  | 'owner'
  | 'admin'
  | 'head_coach'
  | 'assistant_coach'
  | 'coach'
  | 'analyst'
  | 'medical'
  | 'player'

export type OrgContext = {
  /** The auth0Id to scope every org/email/auth-user call against. */
  auth0Id: string
  /** The caller's role within that org (owner fast-path default). */
  role: OrgRole
}

/**
 * Pure org-context decision: given the caller's own sub and their memberships,
 * pick the primary org. An explicit cookie preference wins when it names an
 * org the caller actually belongs to; otherwise owner-of-self wins; otherwise
 * the first membership. Empty memberships → owner-of-self fallback (fresh
 * coach, or memberships unavailable). Never trusts the cookie blindly — the
 * caller's role always comes from the membership row.
 *
 * Lives in this pure module (not lib/serverData) so client components — the
 * settings shell in particular — can resolve org context from getMyOrgs()
 * without pulling in server-only react.cache / next/headers.
 */
export function resolveOrgContext(
  ownSub: string | undefined,
  orgs: Array<{ org_auth0_id: string; role: OrgRole }>,
  preferredOrgId?: string | null,
): OrgContext {
  if (preferredOrgId) {
    const preferred = orgs.find((o) => o.org_auth0_id === preferredOrgId)
    if (preferred) return { auth0Id: preferred.org_auth0_id, role: preferred.role }
  }
  const owned = orgs.find((o) => o.org_auth0_id === ownSub && o.role === 'owner')
  const primary = owned ?? orgs[0]
  if (primary) return { auth0Id: primary.org_auth0_id, role: primary.role }
  return { auth0Id: ownSub ?? '', role: 'owner' }
}

/** Read the org-switcher preference cookie in the browser (null outside DOM). */
export function preferredOrgCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${ORG_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
