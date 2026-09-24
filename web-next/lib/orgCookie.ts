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
