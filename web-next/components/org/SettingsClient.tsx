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
  // One flag PER READ. These three used to share a single `Promise.all` behind one
  // `catch`, so `orgOverview` — an org-STATS call — could reject the whole block and
  // land on `orgFailed`, which buildSettingsSections renders as `<LoadFailed
  // subject="Players" />`: an org-overview outage told a coach their PLAYER ROSTER
  // had failed. The wrong noun in a failure message sends triage to the wrong
  // subsystem, and here it also sends the reader to fix the wrong thing.
  const [rosterFailed, setRosterFailed] = useState(false)
  const [overviewFailed, setOverviewFailed] = useState(false)
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
        // Step 1 is the ORG CONTEXT, not org data: without an org id there is
        // nothing to read, so its failure is its own signal and it short-circuits.
        let ctx: { auth0Id: string; role: OrgMemberRole }
        try {
          const { orgs } = await getMyOrgs()
          if (cancelled) return
          ctx = resolveOrgContext(identity.sub, orgs, preferredOrgCookie())
        } catch {
          if (!cancelled) setOrgFailed(true)
          return
        }
        setAuth0Id(ctx.auth0Id)
        setRole(ctx.role)

        // Step 2: three INDEPENDENT reads. Not a `Promise.all`, because one
        // rejection there discards the other two results and blames all three on
        // whichever failed first.
        void orgStudents(ctx.auth0Id)
          .then((res) => {
            if (!cancelled) setStudents(res.students)
          })
          .catch(() => {
            if (!cancelled) setRosterFailed(true)
          })

        void orgOverview(ctx.auth0Id)
          .then((res) => {
            if (!cancelled) setOverview(res.overview)
          })
          .catch(() => {
            if (!cancelled) setOverviewFailed(true)
          })

        void orgSubscription(ctx.auth0Id)
          .then((res) => {
            if (!cancelled) setSubscription(res)
          })
          .catch(() => {
            // 403 for non-owner/admin is the documented degrade-to-no-Plan case
            // (server/src/routes/org/billing.ts), not a loading problem — a
            // caller without plan access is not entitled to a failure message.
            // `subscription` simply stays null and its section is omitted.
          })
      })()
    }

    return () => {
      cancelled = true
    }
  }, [isDashboard, identity.sub])

  const loadError = profileFailed || orgFailed || rosterFailed || overviewFailed
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
    // `orgFailed` reaches the Players pane, so it must mean the ROSTER read
    // failed — never "some org read failed". The two are separate reads and only
    // one of them paints this pane.
    orgFailed: orgFailed || rosterFailed,
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
            {/* Named per read rather than a blanket "some settings data": an
                org-overview outage previously reported here as a roster failure,
                so the reader was pointed at a subsystem that was working. */}
            {overviewFailed && !rosterFailed
              ? 'Organization stats failed to load.'
              : rosterFailed
                ? 'The player roster failed to load.'
                : 'Failed to load some settings data.'}{' '}
            Try refreshing the page.
          </div>
        ) : null
      }
    />
  )
}
