import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'
import { changePasswordUrl } from '@/lib/authUrls'
import { unstable_noStore as noStore } from 'next/cache'
import SettingsClient, { type SettingsIdentity } from '@/components/org/SettingsClient'

export const metadata: Metadata = {
  title: 'Settings | CoachXYZ',
  description: 'Manage your profile, security, members, and records.',
}

/**
 * Deliberately light: session decode + env only — no DB/API awaits. The panel
 * paints the instant the route resolves; profile and org data load client-side
 * inside SettingsClient (fresh values reconcile in, spinners are inline, and
 * there is never a skeleton between click and panel).
 */
export default async function SettingsPage() {
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

  return (
    <SettingsClient variant="dashboard" identity={identity} passwordUrl={changePasswordUrl()} />
  )
}
