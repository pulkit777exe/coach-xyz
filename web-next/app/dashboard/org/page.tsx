import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  History,
  Target,
  Users,
} from 'lucide-react'

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import {
  getMyOrgsCached,
  getOrgContext,
  getUserProfile,
  orgMembers,
  orgOverview,
  orgSubscription,
} from '@/lib/serverData'
import { ORG_MEMBER_ROLE_LABELS, type OrgMember, type OrgMemberRole } from '@/lib/members'
import { MEMBERS_NAV_ROLES } from '@/lib/nav'
import { Button } from '@/components/9ui/ui/button'
import PageHeader from '@/components/org/PageHeader'
import Section from '@/components/org/Section'
import StatusPill, { type StatusTone } from '@/components/org/StatusPill'
import EmptyState from '@/components/org/EmptyState'
import { initials } from '@/lib/initials'

export const metadata: Metadata = {
  title: 'Organization | CoachXYZ',
  description: 'Workspace details, plan, and staff.',
}

const FEATURE_LINKS = [
  { label: 'History', href: '/dashboard/history', icon: History },
  { label: 'Schedule', href: '/dashboard/schedule', icon: CalendarDays },
  { label: 'Attendance', href: '/dashboard/attendance', icon: ClipboardCheck },
  { label: 'Reports', href: '/dashboard/reports', icon: FileText },
  { label: 'Objectives', href: '/dashboard/students', icon: Target },
  { label: 'Teams', href: '/dashboard/teams', icon: Users },
] as const

function roleTone(role: OrgMemberRole): StatusTone {
  if (role === 'owner') return 'primary'
  if (role === 'admin') return 'blue'
  return 'gray'
}

function DefRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="w-[180px] shrink-0 text-body leading-5 text-muted-foreground">{label}</span>
      <span
        className={
          mono
            ? 'min-w-0 break-all text-right font-mono text-caption leading-4 text-muted-foreground'
            : 'text-body leading-5 tabular-nums text-foreground'
        }
      >
        {value}
      </span>
    </div>
  )
}

function MemberRow({ member }: { member: OrgMember }) {
  const name = member.display_name ?? member.member_email ?? 'Member'
  return (
    <li className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-[4px] bg-muted text-label font-medium text-muted-foreground">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body leading-5 font-medium text-foreground">{name}</p>
        <p className="truncate text-meta text-muted-foreground">
          {member.member_email ?? 'No email on file'}
        </p>
      </div>
      <StatusPill tone={roleTone(member.role)} className="shrink-0">
        {ORG_MEMBER_ROLE_LABELS[member.role]}
      </StatusPill>
    </li>
  )
}

export default async function OrgPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const ownAuth0Id = session.user.sub
  const { auth0Id, role } = orgCtx

  const [profileRes, overviewRes, membersRes, subscriptionRes, orgsRes] = await Promise.all([
    getUserProfile(ownAuth0Id).catch(() => null),
    orgOverview(auth0Id).catch(() => null),
    orgMembers(auth0Id).catch(() => null),
    orgSubscription(auth0Id).catch(() => null),
    getMyOrgsCached().catch(() => null),
  ])

  const overview = overviewRes?.overview ?? null
  const members: OrgMember[] = membersRes?.members ?? []
  const hasMembers = membersRes !== null
  const displayName =
    orgsRes?.orgs.find((o) => o.org_auth0_id === auth0Id)?.display_name ?? 'Organization'
  const roleLabel = ORG_MEMBER_ROLE_LABELS[role]
  const memberCount = membersRes ? String(membersRes.members.length) : '—'
  const studentCount = overview ? String(overview.student_count) : '—'
  const sessionsThisMonth = overview ? String(overview.sessions_this_month) : '—'
  const avgAttendance =
    overview && overview.avg_attendance_rate !== null ? `${overview.avg_attendance_rate}%` : '—'

  const usedAnalyses = subscriptionRes?.usage_today['analysis'] ?? 0
  const analysisLimit = subscriptionRes?.daily_analysis_limit ?? 0
  const usagePct =
    analysisLimit > 0 ? Math.min(100, Math.round((usedAnalyses / analysisLimit) * 100)) : 0

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Organization']}
        title="Organization"
        description="Workspace details, plan, and staff."
        actions={
          // Same floor as the Members nav item — an analyst/medical/assistant
          // coach landing here must not be sent to a page that denies them.
          MEMBERS_NAV_ROLES.includes(role) ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/dashboard/members" />}
            >
              Manage members
            </Button>
          ) : null
        }
      />

      <div className="space-y-8">
        {/* Identity */}
        <div className="rounded-[6px] border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-[6px] bg-primary text-lg font-semibold text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-foreground">{displayName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-body leading-5 text-muted-foreground">Your role</span>
                <StatusPill tone={roleTone(role)}>{roleLabel}</StatusPill>
              </div>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-1">
            <DefRow label="Organization ID" value={auth0Id} mono />
            <DefRow
              label="Your account"
              value={profileRes?.user.email ?? session.user.email ?? '—'}
            />
            <DefRow label="Members" value={memberCount} />
            <DefRow label="Students" value={studentCount} />
            <DefRow label="Sessions this month" value={sessionsThisMonth} />
            <DefRow label="Avg attendance" value={avgAttendance} />
          </div>
        </div>

        {/* Staff */}
        <Section title="Staff">
          {hasMembers && members.length > 0 ? (
            <div>
              <ul>
                {members.slice(0, 5).map((m) => (
                  <MemberRow key={m.id} member={m} />
                ))}
              </ul>
              <Link
                href="/dashboard/members"
                className="mt-3 flex h-9 items-center justify-between rounded-[4px] px-3 text-body leading-5 font-medium text-primary transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                View all members
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          ) : hasMembers ? (
            <EmptyState
              compact
              title="No staff members yet"
              description="Invite coaches, analysts and medical staff from the members page."
              action={
                <Button size="sm" nativeButton={false} render={<Link href="/dashboard/members" />}>
                  Invite someone
                </Button>
              }
            />
          ) : (
            <EmptyState
              compact
              title="Members are only available to staff"
              description="Ask an organization owner or admin if you need access."
            />
          )}
        </Section>

        {/* Plan & usage */}
        <Section title="Plan & Usage">
          {subscriptionRes ? (
            <div className="rounded-[6px] border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="primary" className="uppercase tracking-[0.06em]">
                  {subscriptionRes.subscription.tier}
                </StatusPill>
                <StatusPill
                  tone={subscriptionRes.subscription.status === 'active' ? 'green' : 'gray'}
                >
                  {subscriptionRes.subscription.status}
                </StatusPill>
                <span className="ml-auto text-body leading-5 tabular-nums text-foreground">
                  {usedAnalyses} / {analysisLimit} analyses today
                </span>
              </div>
              <div className="mt-4 h-1 rounded-full bg-muted">
                <div
                  className="h-1 rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-body leading-5 text-muted-foreground">
              Plan details are available to organization owners.
            </p>
          )}
        </Section>

        {/* What's enabled */}
        <Section title="What's enabled">
          <div className="flex flex-wrap gap-2">
            {FEATURE_LINKS.map((f) => (
              <Link
                key={f.label}
                href={f.href}
                className="inline-flex h-8 items-center gap-2 rounded-[6px] border border-border px-3 text-body leading-5 text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <f.icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {f.label}
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
