import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import {
  getOrgContext,
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
import Section from '@/components/org/Section'
import StatusPill from '@/components/org/StatusPill'
import ProfileForm from '@/components/org/ProfileForm'
import PreferencesSection from '@/components/org/PreferencesSection'
import MembersSection from '@/components/org/MembersSection'

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

// Settings row: 14px/500 label + 13px muted description on the left, control on the right.
function SettingRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <span className="text-[14px] font-medium leading-[1.4] text-foreground">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default async function SettingsPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const ownAuth0Id = session.user.sub
  const { auth0Id } = await getOrgContext()

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
    const [profileRes, studentsRes, overviewRes, membersRes, subscriptionRes] = await Promise.all([
      getUserProfile(ownAuth0Id),
      orgStudents(auth0Id),
      orgOverview(auth0Id),
      orgMembers(auth0Id),
      orgSubscription(auth0Id).catch(() => null),
    ])
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

      {error ? (
        <div className="mb-6 rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
          Failed to load some settings data. Try refreshing the page.
        </div>
      ) : null}

      <div className="space-y-8">
        <PreferencesSection />

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

        <Section title="Security">
          <div>
            <SettingRow label="Email Verified">
              {emailVerified ? (
                <StatusPill tone="green">
                  <Check className="mr-1 size-3" aria-hidden="true" />
                  Verified
                </StatusPill>
              ) : (
                <span className="text-[13px] text-muted-foreground">No</span>
              )}
            </SettingRow>
            <SettingRow label="Password">
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
                <span className="text-[13px] text-muted-foreground">
                  Ask your administrator to reset your password.
                </span>
              )}
            </SettingRow>
            <SettingRow label="Session">
              <Button
                variant="destructive"
                size="sm"
                nativeButton={false}
                render={<a href="/auth/logout" />}
              >
                <LogOut className="size-3.5" />
                Log Out
              </Button>
            </SettingRow>
          </div>
        </Section>

        <MembersSection auth0Id={auth0Id} initialData={membersData} />

        {subscription ? (
          <Section title="Plan & Usage">
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <p className="text-[24px] font-semibold capitalize leading-[1.1] tracking-[-0.01em] text-foreground">
                  {subscription.tier}
                </p>
                <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Plan
                </p>
              </div>
              <div>
                <p className="text-[24px] font-semibold leading-[1.1] tabular-nums text-foreground">
                  {subscription.usage_today['analysis'] ?? 0} / {subscription.daily_analysis_limit}
                </p>
                <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Analyses today
                </p>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Usage is metered per analysis for future billing tiers.
              </p>
            </div>
          </Section>
        ) : null}

        <Section title="Members">
          {students && students.length > 0 ? (
            <ul>
              {students.map((s) => {
                const linked = Boolean(s.account_auth0_id)
                const contact = s.email || s.phone || 'No contact on file'
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground">
                      {initials(s.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium leading-[1.4] text-foreground">
                        {s.full_name}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {contact}
                        {s.sport ? ` · ${s.sport}` : ''}
                      </p>
                    </div>
                    {linked ? (
                      <StatusPill tone="primary">Player account linked</StatusPill>
                    ) : (
                      <span className="shrink-0 text-[13px] text-muted-foreground">
                        Not linked yet
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-[14px] text-muted-foreground">
              {students === null ? 'Members failed to load.' : 'No players on the roster yet.'}
            </p>
          )}
        </Section>

        {tiles.length > 0 && (
          <Section title="Records">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tiles.map((t) => (
                <Link
                  key={t.label}
                  href={t.href}
                  className="rounded-[6px] border border-border bg-card p-5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {t.label}
                    </span>
                    <t.icon className="size-4 text-muted-foreground/60" />
                  </div>
                  <p className="mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums text-foreground">
                    {t.value}
                  </p>
                </Link>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
