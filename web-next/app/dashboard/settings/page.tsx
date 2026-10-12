import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users,
  UserCheck,
  ClipboardCheck,
  CalendarDays,
  History,
  Gauge,
  KeyRound,
  LogOut,
  Check,
} from 'lucide-react'

import {
  getUserProfile,
  orgStudents,
  orgOverview,
  orgMembers,
  orgSubscription,
} from '@/lib/serverData'
import type { Student, OrgOverview } from '@/lib/org'
import type { OrgMembersResponse } from '@/lib/members'
import UserAvatar from '@/components/UserAvatar'
import { Button } from '@/components/9ui/ui/button'
import PageHeader from '@/components/org/PageHeader'
import ProfileForm from '@/components/org/ProfileForm'
import PreferencesSection from '@/components/org/PreferencesSection'
import MembersSection from '@/components/org/MembersSection'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Settings | CoachXYZ',
  description: 'Manage your profile, security, members, and records.',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  return parts[0].substring(0, 2).toUpperCase()
}

function changePasswordUrl(): string | null {
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

export default async function SettingsPage() {
  // Gate first: the render falls back to session fields when fetches fail,
  // so the session must be resolved before the whole-block try/catch.
  const { session, auth0Id } = await loadPage('org', {})
  const ownAuth0Id = session.user.sub

  let profile = null
  let students: Student[] | null = null
  let overview: OrgOverview | null = null
  let membersData: OrgMembersResponse | null = null
  let subscription: {
    tier: string
    status: string
    usage_today: Record<string, number>
    daily_analysis_limit: number
  } | null = null
  let error: string | null = null

  try {
    const { data } = await loadPage('org', {
      profile: () => getUserProfile(ownAuth0Id),
      students: ({ auth0Id }) => orgStudents(auth0Id),
      overview: ({ auth0Id }) => orgOverview(auth0Id),
      members: ({ auth0Id }) => orgMembers(auth0Id),
      subscription: ({ auth0Id }) => orgSubscription(auth0Id).catch(() => null),
    })
    const profileRes = data.profile
    const studentsRes = data.students
    const overviewRes = data.overview
    const membersRes = data.members
    const subscriptionRes = data.subscription
    profile = profileRes.user
    students = studentsRes.students
    overview = overviewRes.overview
    membersData = membersRes
    if (subscriptionRes) {
      subscription = {
        tier: subscriptionRes.subscription.tier,
        status: subscriptionRes.subscription.status,
        usage_today: subscriptionRes.usage_today,
        daily_analysis_limit: subscriptionRes.daily_analysis_limit,
      }
    }
  } catch (err) {
    console.error('Failed to load settings data:', err)
    error = err instanceof Error ? err.message : 'Failed to load settings data'
  }

  const emailVerified = profile?.email_verified ?? Boolean(session.user.email_verified)
  const passwordUrl = changePasswordUrl()

  const tiles = overview
    ? [
        {
          icon: Users,
          label: 'Students',
          value: overview.student_count,
          href: '/dashboard/students',
        },
        {
          icon: UserCheck,
          label: 'Active Students',
          value: overview.active_students,
          href: '/dashboard/students',
        },
        {
          icon: ClipboardCheck,
          label: 'Sessions This Month',
          value: overview.sessions_this_month,
          href: '/dashboard/attendance',
        },
        {
          icon: CalendarDays,
          label: 'Upcoming Events',
          value: overview.upcoming_events,
          href: '/dashboard/schedule',
        },
        {
          icon: History,
          label: 'Analyses Linked',
          value: overview.analyses_linked,
          href: '/dashboard/history',
        },
        {
          icon: Gauge,
          label: 'Avg Attendance Rate',
          value: overview.avg_attendance_rate !== null ? `${overview.avg_attendance_rate}%` : '—',
          href: '/dashboard/reports',
        },
      ]
    : []

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Settings']}
        title="Settings"
        description="Choose how you want CoachXYZ to look and behave."
      />

      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load some settings data. Try refreshing the page.
        </div>
      )}

      <PreferencesSection />

      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Profile
          </p>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-4">
            <UserAvatar
              picture={profile?.picture ?? session.user.picture}
              name={profile?.name ?? session.user.name}
              email={profile?.email ?? session.user.email}
              size="lg"
            />
            <div>
              <p className="text-lg font-semibold text-foreground">
                {profile?.name ?? session.user.name ?? 'No name'}
              </p>
              <p className="text-sm text-muted-foreground">
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
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Security
          </p>
        </div>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 px-6 py-3.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Email Verified
            </span>
            {emailVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <Check className="size-3" />
                Verified
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">No</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-3.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Password
            </span>
            {passwordUrl ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={passwordUrl} />}
              >
                <KeyRound className="size-3.5" />
                Change Password
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">
                Ask your administrator to reset your password.
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-3.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Session
            </span>
            <Button
              variant="destructive"
              size="sm"
              nativeButton={false}
              render={<a href="/auth/logout" />}
            >
              <LogOut className="size-3.5" />
              Log Out
            </Button>
          </div>
        </div>
      </div>

      <MembersSection auth0Id={auth0Id} initialData={membersData} />

      {subscription && (
        <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Plan & Usage
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 px-6 py-4">
            <div>
              <p className="text-lg font-bold capitalize tracking-tight text-foreground">
                {subscription.tier}
              </p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Plan
              </p>
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-foreground">
                {subscription.usage_today['analysis'] ?? 0} / {subscription.daily_analysis_limit}
              </p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Analyses today
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Usage is metered per analysis for future billing tiers.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Members
          </p>
        </div>
        {students && students.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden">
            {students.map((s) => {
              const linked = Boolean(s.account_auth0_id)
              const contact = s.email || s.phone || 'No contact on file'
              return (
                <li key={s.id} className="flex items-center gap-4 bg-card px-6 py-3.5">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                    {initials(s.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{s.full_name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {contact}
                      {s.sport ? ` · ${s.sport}` : ''}
                    </p>
                  </div>
                  {linked ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      Player account linked
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Not linked yet</span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            {students === null ? 'Members failed to load.' : 'No players on the roster yet.'}
          </p>
        )}
      </div>

      {tiles.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Records
            </p>
          </div>
          <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted"
              >
                <t.icon className="size-5 text-muted-foreground" />
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{t.value}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {t.label}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
