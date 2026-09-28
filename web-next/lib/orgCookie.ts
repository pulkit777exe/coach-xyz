/** Cookie that persists the org-switcher selection (path=/, samesite=lax). */
export const ORG_COOKIE = 'coach_org'

/** Persist the org-switcher selection in the browser (no-op outside the DOM). */
export function setOrgCookie(orgId: string): void {
  if (typeof document === 'undefined') return
  const isLocal =
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(window.location.hostname)
  document.cookie = `${ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; max-age=31536000; samesite=lax${isLocal ? '' : '; Secure'}`
}

/** Read the persisted org-switcher selection (null outside the DOM). */
export function getOrgCookie(): string | null {
  if (typeof document === 'undefined') return null
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ORG_COOKIE}=`))
  return found ? decodeURIComponent(found.slice(ORG_COOKIE.length + 1)) : null
}

/** Drop the persisted selection (no-op outside the DOM). */
export function clearOrgCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${ORG_COOKIE}=; path=/; max-age=0; samesite=lax`
}
