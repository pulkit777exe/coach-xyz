/**
 * Auth0 change-password deep link (server-only — reads env). Shared by the
 * dashboard and player settings pages so both offer the Security section.
 */
export function changePasswordUrl(): string | null {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, APP_BASE_URL } = process.env
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !APP_BASE_URL) return null
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: `${APP_BASE_URL}/auth/callback`,
    prompt: 'change-password',
    scope: 'openid profile email',
  })
  return `https://${AUTH0_DOMAIN}/authorize?${params.toString()}`
}
