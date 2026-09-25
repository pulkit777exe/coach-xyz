import Link from 'next/link'
import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Gauge,
  History,
  KeyRound,
  LogOut,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

import UserAvatar from '@/components/UserAvatar'
import { Button } from '@/components/9ui/ui/button'
import Section from '@/components/org/Section'
import StatusPill from '@/components/org/StatusPill'
import ProfileForm from '@/components/org/ProfileForm'
import PreferencesSection from '@/components/org/PreferencesSection'
import MembersSection from '@/components/org/MembersSection'
import SettingRow from '@/components/org/SettingRow'
import type { SettingsSection } from '@/components/org/SettingsPanel'
import { Spinner } from '@/components/org/Spinner'

import type { OrgOverview, Student, orgSubscription } from '@/lib/org'
import type { UserRecord } from '@/lib/api'

/**
 * Session identity, passed down from the (light) server page. The panel must
 * paint on this alone — everything else (fresh profile, org data) arrives
 * client-side after mount so opening Settings never waits on the network.
 */
export type SettingsIdentity = {
  sub: string
  name: string | null
  email: string | null
  picture: string | null
  nickname: string | null
  emailVerified: boolean
}

export type SubscriptionInfo = Awaited<ReturnType<typeof orgSubscription>>

type SettingsTile = {
  icon: LucideIcon
  label: string
  value: string | number
  href: string
}

type SettingsSectionsProps = {
  isDashboard: boolean
  identity: SettingsIdentity
  profile: UserRecord | null
  emailVerified: boolean
  passwordUrl: string | null
  auth0Id: string | null
  students: Student[] | null
  overview: OrgOverview | null
  subscription: SubscriptionInfo | null
  orgFailed: boolean
}

function buildDashboardTiles(overview: OrgOverview | null): SettingsTile[] {
  return [
    {
      icon: Users,
      label: 'Students',
      value: overview?.student_count ?? '—',
      href: '/dashboard/students',
    },
    {
      icon: UserCheck,
      label: 'Active Students',
      value: overview?.active_students ?? '—',
      href: '/dashboard/students',
    },
    {
      icon: ClipboardCheck,
      label: 'Sessions This Month',
      value: overview?.sessions_this_month ?? '—',
      href: '/dashboard/attendance',
    },
    {
      icon: CalendarDays,
      label: 'Upcoming Events',
      value: overview?.upcoming_events ?? '—',
      href: '/dashboard/schedule',
    },
    {
      icon: History,
      label: 'Analyses Linked',
      value: overview?.analyses_linked ?? '—',
      href: '/dashboard/history',
    },
    {
      icon: Gauge,
      label: 'Avg Attendance Rate',
      value:
        overview && overview.avg_attendance_rate !== null
          ? `${overview.avg_attendance_rate}%`
          : '—',
      href: '/dashboard/reports',
    },
  ]
}

/** Matches MembersSection's centered loader — a spinner, never a skeleton. */
function CenterSpin() {
  return (
    <div className="flex items-center justify-center py-10">
      <Spinner className="text-muted-foreground" />
    </div>
  )
}

function LoadFailed() {
  return <p className="py-8 text-center text-body text-muted-foreground">Members failed to load.</p>
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  return parts[0].substring(0, 2).toUpperCase()
}

export default function buildSettingsSections({
  isDashboard,
  identity,
  profile,
  emailVerified,
  passwordUrl,
  auth0Id,
  students,
  overview,
  subscription,
  orgFailed,
}: SettingsSectionsProps): SettingsSection[] {
  const tiles = buildDashboardTiles(overview)
  const sections: SettingsSection[] = [
    {
      id: 'my-account',
      label: 'My account',
      icon: 'account',
      content: (
        <Section title="My account">
          <div className="flex items-center gap-4">
            <UserAvatar
              picture={profile?.picture ?? identity.picture}
              name={profile?.name ?? identity.name}
              email={profile?.email ?? identity.email}
              size="lg"
            />
            <div>
              <p className="text-lead font-semibold leading-[1.4] text-foreground">
                {profile?.name ?? identity.name ?? 'No name'}
              </p>
              <p className="mt-0.5 text-meta text-muted-foreground">
                {profile?.email ?? identity.email}
              </p>
            </div>
          </div>
          <div className="mt-6 max-w-xl">
            <ProfileForm
              initialName={identity.name}
              initialNickname={identity.nickname}
              initialPicture={identity.picture}
              fresh={profile}
            />
          </div>
        </Section>
      ),
    },
    {
      id: 'security',
      label: 'Security',
      icon: 'security',
      content: (
        <Section title="Security">
          <div>
            <SettingRow title="Email Verified">
              {emailVerified ? (
                <StatusPill tone="green">
                  <Check className="mr-1 size-3" aria-hidden="true" />
                  Verified
                </StatusPill>
              ) : (
                <span className="text-meta text-muted-foreground">No</span>
              )}
            </SettingRow>
            <SettingRow title="Password">
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
                <span className="text-meta text-muted-foreground">
                  Ask your administrator to reset your password.
                </span>
              )}
            </SettingRow>
            <SettingRow title="Session">
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
      ),
    },
    {
      id: 'preferences',
      label: 'Preferences',
      icon: 'preferences',
      content: <PreferencesSection />,
    },
  ]

  if (isDashboard) {
    sections.push({
      id: 'members',
      label: 'Members',
      icon: 'members',
      content: (
        // MembersSection ships a page-level mt-8 — cancel it when it leads
        // the panel section so headings align with the other nav sections.
        <div className="flex flex-col gap-8 [&>div:first-child]:mt-0">
          {auth0Id ? (
            <MembersSection auth0Id={auth0Id} />
          ) : orgFailed ? (
            <LoadFailed />
          ) : (
            <CenterSpin />
          )}

          <Section title="Players">
            {students !== null ? (
              students.length > 0 ? (
                <ul>
                  {students.map((s) => {
                    const linked = Boolean(s.account_auth0_id)
                    const contact = s.email || s.phone || 'No contact on file'
                    return (
                      <li
                        key={s.id}
                        className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0"
                      >
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground">
                          {initials(s.full_name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium leading-[1.4] text-foreground">
                            {s.full_name}
                          </p>
                          <p className="mt-0.5 truncate text-meta text-muted-foreground">
                            {contact}
                            {s.sport ? ` · ${s.sport}` : ''}
                          </p>
                        </div>
                        {linked ? (
                          <StatusPill tone="primary">Player account linked</StatusPill>
                        ) : (
                          <span className="shrink-0 text-meta text-muted-foreground">
                            Not linked yet
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="py-8 text-center text-body text-muted-foreground">
                  No players on the roster yet.
                </p>
              )
            ) : orgFailed ? (
              <LoadFailed />
            ) : (
              <CenterSpin />
            )}
          </Section>
        </div>
      ),
    })

    if (subscription) {
      sections.push({
        id: 'plan-usage',
        label: 'Plan & usage',
        icon: 'plan',
        content: (
          <Section title="Plan & Usage">
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <p className="text-[24px] font-semibold capitalize leading-[1.1] tracking-[-0.01em] text-foreground">
                  {subscription.subscription.tier}
                </p>
                <p className="mt-1.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Plan
                </p>
              </div>
              <div>
                <p className="text-[24px] font-semibold leading-[1.1] tabular-nums text-foreground">
                  {subscription.usage_today['analysis'] ?? 0} / {subscription.daily_analysis_limit}
                </p>
                <p className="mt-1.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Analyses today
                </p>
              </div>
              <p className="text-meta text-muted-foreground">
                Usage is metered per analysis for future billing tiers.
              </p>
            </div>
          </Section>
        ),
      })
    }

    // Records is always in the nav (stable left pane) — tiles render em-dashes
    // until the overview arrives; no skeleton, no layout jump.
    sections.push({
      id: 'records',
      label: 'Records',
      icon: 'records',
      content: (
        <Section title="Records">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="rounded-[6px] border border-border bg-card p-5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
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
      ),
    })
  }

  return sections
}
