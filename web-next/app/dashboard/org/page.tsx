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

/**
 * Did this read fail because the caller's role is refused, or for some other
 * reason? `apiFetch` reduces every non-OK response to a `CoachAIError`, which
 * carries the server's `code` but NOT the HTTP status — so `FORBIDDEN` is the
 * only signal available for "your role cannot read this", and it is what the
 * guard answers with (server/src/lib/serviceGuard.ts `verifyOrgRole`). Anything
 * else — a 5xx, a timeout, a dropped connection — established nothing about the
 * caller's permissions.
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 'FORBIDDEN'
  )
}

/**
 * A read that may have failed, keeping the failure REASON rather than collapsing
 * it to `null`. The old shape returned `null` for both "your role may not read
 * this" and "this 500'd", and the render below branched on that single null —
 * so an owner whose members read failed was told to go ask an owner for access.
 */
type Read<T> = { ok: true; value: T } | { ok: false; denied: boolean }

async function read<T>(p: Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await p }
  } catch (err) {
    return { ok: false, denied: isPermissionDenied(err) }
  }
}

export default async function OrgPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const ownAuth0Id = session.user.sub
  const { auth0Id, role } = orgCtx

  const [profileRes, overviewRes, membersRead, subscriptionRead, orgsRes] = await Promise.all([
    getUserProfile(ownAuth0Id).catch(() => null),
    read(orgOverview(auth0Id)),
    // The one read whose failure reason changes what we may SAY: a refusal is a
    // permission fact, a 5xx is not, and the copy below must not assert one it
    // has not established.
    read(orgMembers(auth0Id)),
    read(orgSubscription(auth0Id)),
    getMyOrgsCached().catch(() => null),
  ])

  const subscriptionRes = subscriptionRead.ok ? subscriptionRead.value : null
  // `subscription === null` cannot say which of the two it was — the same value
  // covers "this role may not read the plan" and "the read failed" — and guessing
  // a reason is the defect wearing better manners.
  const subscriptionFailed = !subscriptionRead.ok && !subscriptionRead.denied

  const overview = overviewRes.ok ? (overviewRes.value.overview ?? null) : null
  const members: OrgMember[] = membersRead.ok ? (membersRead.value.members ?? []) : []
  // A `FORBIDDEN` on the members read IS a permission fact. A failed read is not,
  // and gets its own state rather than borrowing the denial's copy.
  const membersDenied = !membersRead.ok && membersRead.denied
  const membersFailed = !membersRead.ok && !membersRead.denied
  const hasMembers = membersRead.ok
  const displayName =
    orgsRes?.orgs.find((o) => o.org_auth0_id === auth0Id)?.display_name ?? 'Organization'
  const roleLabel = ORG_MEMBER_ROLE_LABELS[role]
  // Honest about failure too: `—` rather than a fabricated `0` members, which is
  // the same claim a real empty roster would make.
  const memberCount = membersRead.ok ? String(members.length) : '—'
  const studentCount = overview ? String(overview.student_count) : '—'
  const sessionsThisMonth = overview ? String(overview.sessions_this_month) : '—'
  const avgAttendance =
    overview && overview.avg_attendance_rate !== null ? `${overview.avg_attendance_rate}%` : '—'

  // `subscription` is an async response, so a partial one (or a shape change) must
  // not throw here — `OrgSubscription` types both of these as required, so nothing
  // but an explicit guard catches it. `subscriptionRes?.usage_today` only guards
  // the OUTER object; `usage_today['analysis']` threw during render on a payload
  // missing that field, taking the route's error boundary rather than degrading
  // one number. Same two dereferences as components/dashboard/OwnerHome.tsx.
  const tier = subscriptionRes?.subscription?.tier
  const usage = subscriptionRes?.usage_today
  // Absent `usage_today` is UNKNOWN; an empty one is a real zero. The server builds
  // it from the usage rows it found (`getTodayUsage`), so an org that ran nothing
  // today gets `{}` and must read as 0 — a partial payload must not print a
  // confident "0 analyses today".
  const usedAnalyses = usage === undefined ? undefined : (usage['analysis'] ?? 0)
  // Absent limit is UNKNOWN: `?? 0` would assert a plan permitting no analyses.
  const analysisLimit = subscriptionRes?.daily_analysis_limit
  const usagePct =
    usedAnalyses !== undefined && analysisLimit !== undefined && analysisLimit > 0
      ? Math.min(100, Math.round((usedAnalyses / analysisLimit) * 100))
      : 0

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
          ) : membersDenied ? (
            // Reached only on an actual FORBIDDEN, so "only available to staff" is
            // a fact the server established about this caller.
            <EmptyState
              compact
              title="Members are only available to staff"
              description="Ask an organization owner or admin if you need access."
            />
          ) : membersFailed ? (
            // A failed read is a LOADING problem. Telling an owner to go ask an
            // owner for access — the copy above — is false: they already have it,
            // and the message sends them off to request a permission they hold.
            <EmptyState
              compact
              title="Members failed to load."
              description="This is a loading problem, not an access restriction — retry the page."
            />
          ) : null}
        </Section>

        {/* Plan & usage */}
        <Section title="Plan & Usage">
          {subscriptionRes ? (
            <div className="rounded-[6px] border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="primary" className="uppercase tracking-[0.06em]">
                  {tier ?? '—'}
                </StatusPill>
                <StatusPill
                  tone={subscriptionRes.subscription?.status === 'active' ? 'green' : 'gray'}
                >
                  {subscriptionRes.subscription?.status ?? '—'}
                </StatusPill>
                <span className="ml-auto text-body leading-5 tabular-nums text-foreground">
                  {/* `—` for an unreadable half, never `0`: "0 / 0" asserts a plan
                      permitting no analyses, and "0 / 20" asserts no usage was made —
                      both numbers the response does not carry. */}
                  {usedAnalyses ?? '—'} / {analysisLimit ?? '—'} analyses today
                </span>
              </div>
              <div className="mt-4 h-1 rounded-full bg-muted">
                <div
                  className="h-1 rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </div>
          ) : subscriptionFailed ? (
            // Reads as a failure, because that is what it is: the page fetched this
            // and the fetch rejected. The old copy said "available to organization
            // owners" here, which is a claim about the VIEWER and was false for the
            // owner reading it.
            <p className="text-body leading-5 text-muted-foreground">
              Plan details failed to load.
            </p>
          ) : (
            // The remaining null: this role is not entitled to read the plan. The
            // copy asserts nothing about who — a role the page cannot confirm must
            // not be named as the reason.
            <p className="text-body leading-5 text-muted-foreground">
              Plan details are unavailable.
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
