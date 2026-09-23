import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import { getUserProfile } from '@/lib/serverData'
import UserAvatar from '@/components/UserAvatar'
import Section from '@/components/org/Section'
import ProfileForm from '@/components/org/ProfileForm'
import PreferencesSection from '@/components/org/PreferencesSection'
import SettingsPanel, { type SettingsSection } from '@/components/org/SettingsPanel'

export const metadata: Metadata = {
  title: 'Settings | CoachXYZ',
  description: 'Manage your profile and preferences.',
}

/**
 * Player settings — same two-pane pop-out as /dashboard/settings, trimmed to
 * the self-service sections (My account + Preferences). No org data: players
 * are blocked from every /api/org/* route server-side, so nothing here may
 * import from lib/org, lib/members, or their serverData fetchers.
 */
export default async function PlayerSettingsPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')

  // Fresh name/picture/nickname (the session copy goes stale after a profile
  // save); the identity route — not an org route — so players may call it.
  let profile = null
  try {
    const result = await getUserProfile(session.user.sub)
    profile = result.user
  } catch (err) {
    console.error('Failed to load player profile:', err)
  }

  const sections: SettingsSection[] = [
    {
      id: 'my-account',
      label: 'My account',
      icon: 'account',
      content: (
        <Section title="Profile">
          <div className="flex items-center gap-4">
            <UserAvatar
              picture={profile?.picture ?? session.user.picture}
              name={profile?.name ?? session.user.name}
              email={profile?.email ?? session.user.email}
              size="lg"
            />
            <div>
              <p className="text-[16px] font-semibold leading-[1.4] text-foreground">
                {profile?.name ?? session.user.name ?? 'No name'}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {profile?.email ?? session.user.email}
              </p>
            </div>
          </div>
          <div className="mt-6 max-w-xl">
            <ProfileForm
              initialName={profile?.name ?? session.user.name ?? null}
              initialNickname={profile?.nickname ?? session.user.nickname ?? null}
              initialPicture={profile?.picture ?? session.user.picture ?? null}
            />
          </div>
        </Section>
      ),
    },
    {
      id: 'preferences',
      label: 'Preferences',
      icon: 'preferences',
      content: <PreferencesSection />,
    },
  ]

  return (
    <SettingsPanel
      title="Settings"
      description="Your profile and preferences."
      closeHref="/player"
      sections={sections}
    />
  )
}
