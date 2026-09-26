'use client'

import { useEffect, useState } from 'react'

import SettingsPanel from '@/components/org/SettingsPanel'
import buildSettingsSections, {
  type SettingsIdentity,
  type SubscriptionInfo,
} from '@/components/org/settings/buildSettingsSections'
import { getMyOrgs, getMyProfile } from '@/lib/meApi'
import { orgOverview, orgStudents, orgSubscription } from '@/lib/org'
import type { OrgOverview, Student } from '@/lib/org'
import type { UserRecord } from '@/lib/api'
import { preferredOrgCookie, resolveOrgContext } from '@/lib/orgContext'
import type { OrgMemberRole } from '@/lib/members'

export type { SettingsIdentity } from '@/components/org/settings/buildSettingsSections'

export default function SettingsClient({
  variant,
  identity,
  passwordUrl = null,
}: {
  variant: 'dashboard' | 'player'
  identity: SettingsIdentity
  passwordUrl?: string | null
}) {
  const isDashboard = variant === 'dashboard'
  const [profile, setProfile] = useState<UserRecord | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)
  const [orgFailed, setOrgFailed] = useState(false)
  const [auth0Id, setAuth0Id] = useState<string | null>(null)
  const [role, setRole] = useState<OrgMemberRole | null>(null)
  const [students, setStudents] = useState<Student[] | null>(null)
  const [overview, setOverview] = useState<OrgOverview | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)

  useEffect(() => {
    let cancelled = false

    // Fresh name/picture/nickname + email_verified (the session copy goes
    // stale after a profile save). Non-blocking: the panel is already open.
    void getMyProfile()
      .then((res) => {
        if (!cancelled) setProfile(res.user)
      })
      .catch(() => {
        if (!cancelled) setProfileFailed(true)
      })

    // Org data is dashboard-only — players are blocked from /api/org/* and
    // the player shell renders just My account + Preferences.
    if (isDashboard) {
      void (async () => {
        try {
          const { orgs } = await getMyOrgs()
          if (cancelled) return
          const ctx = resolveOrgContext(identity.sub, orgs, preferredOrgCookie())
          setAuth0Id(ctx.auth0Id)
          setRole(ctx.role)
          const [studentsRes, overviewRes, subscriptionRes] = await Promise.all([
            orgStudents(ctx.auth0Id),
            orgOverview(ctx.auth0Id),
            // orgSubscription 403s for non-owner/admin — degrade to no Plan.
            orgSubscription(ctx.auth0Id).catch(() => null),
          ])
          if (cancelled) return
          setStudents(studentsRes.students)
          setOverview(overviewRes.overview)
          setSubscription(subscriptionRes)
        } catch {
          if (!cancelled) setOrgFailed(true)
        }
      })()
    }

    return () => {
      cancelled = true
    }
  }, [isDashboard, identity.sub])

  const loadError = profileFailed || orgFailed
  const emailVerified = profile ? profile.email_verified : identity.emailVerified

  const sections = buildSettingsSections({
    isDashboard,
    identity,
    profile,
    emailVerified,
    passwordUrl,
    auth0Id,
    role,
    students,
    overview,
    subscription,
    orgFailed,
  })

  return (
    <SettingsPanel
      title="Settings"
      description={
        isDashboard
          ? 'Choose how you want CoachXYZ to look and behave.'
          : 'Your profile and preferences.'
      }
      closeHref={isDashboard ? '/dashboard' : '/player'}
      sections={sections}
      notice={
        loadError ? (
          <div className="rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-body text-destructive">
            Failed to load some settings data. Try refreshing the page.
          </div>
        ) : null
      }
    />
  )
}
