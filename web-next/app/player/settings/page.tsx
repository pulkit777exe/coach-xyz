import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'
import { changePasswordUrl } from '@/lib/authUrls'
import { unstable_noStore as noStore } from 'next/cache'
import SettingsClient, { type SettingsIdentity } from '@/components/org/SettingsClient'

export const metadata: Metadata = {
  title: 'Settings | CoachXYZ',
  description: 'Manage your profile and preferences.',
}

/**
 * Player settings — same two-pane pop-out as /dashboard/settings: My account,
 * Security, and Preferences (org sections are skipped — players are blocked
 * from every /api/org/* route server-side, so SettingsClient only fetches the
 * identity route here).
 *
 * Light by design (see the dashboard settings page): session decode only, so
 * the panel is instant — the fresh profile reconciles in client-side.
 */
export default async function PlayerSettingsPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')

  const identity: SettingsIdentity = {
    sub: session.user.sub,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    picture: session.user.picture ?? null,
    nickname: session.user.nickname ?? null,
    emailVerified: Boolean(session.user.email_verified),
  }

  return <SettingsClient variant="player" identity={identity} passwordUrl={changePasswordUrl()} />
}
