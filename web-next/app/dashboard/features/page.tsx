import type { Metadata } from 'next'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  History,
  Link2,
  Shield,
  Sparkles,
  Target,
  UserRound,
  Users,
} from 'lucide-react'

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import { getOrgContext, type OrgRole } from '@/lib/serverData'
import { AUDIT_NAV_ROLES, HISTORY_NAV_ROLES, MEMBERS_NAV_ROLES, type NavRole } from '@/lib/nav'
import { Button } from '@/components/9ui/ui/button'
import PageHeader from '@/components/org/PageHeader'
import Section from '@/components/org/Section'

export const metadata: Metadata = {
  title: 'Features | CoachXYZ',
  description: 'Everything CoachXYZ does — what you have access to today.',
}

type Feature = {
  icon: LucideIcon
  title: string
  body: string
  href: string
  /** When set, only these org roles see the card (nav gating vocabulary). */
  roles?: readonly NavRole[]
}

// Verified against sports/*.json + engine/core/sport_config.py, ORG_MEMBER_ROLES
// (8 entries) and types/index.ts MAX_FILE_SIZE_BYTES (500 * 1024 * 1024).
const STATS = [
  { label: 'Sports', value: '6' },
  { label: 'Typical analysis', value: '60s' },
  { label: 'Staff roles', value: '8' },
  { label: 'Max clip size', value: '500 MB' },
] as const

const ANALYZE: Feature[] = [
  {
    icon: Sparkles,
    title: 'Video analysis pipeline',
    body: 'Upload a clip — CoachXYZ detects every athlete, annotates form with pose overlays, and returns a scored report in about 60 seconds.',
    href: '/',
  },
  {
    icon: History,
    title: 'Analysis history',
    body: 'Every past job with a findings timeline, clip markers, timestamp pills, and AI chat about the analysis.',
    href: '/dashboard/history',
    roles: HISTORY_NAV_ROLES,
  },
  {
    icon: FileText,
    title: 'Reports',
    body: 'Generate, print and email print-friendly reports tied to a student and session.',
    href: '/dashboard/reports',
  },
]

const COACH: Feature[] = [
  {
    icon: CalendarDays,
    title: 'Schedule',
    body: 'Month calendar for sessions and events, with a week-starts-Monday preference.',
    href: '/dashboard/schedule',
  },
  {
    icon: ClipboardCheck,
    title: 'Attendance',
    body: 'Monthly attendance grid per student, plus one-click email attendance sheets.',
    href: '/dashboard/attendance',
  },
  {
    icon: Users,
    title: 'Teams & seasons',
    body: 'Group students into teams and seasons to keep rosters organized.',
    href: '/dashboard/teams',
  },
  {
    icon: Target,
    title: 'Objectives',
    body: 'List and Board (kanban) views for coaching objectives, linkable to analysis findings.',
    href: '/dashboard/students',
  },
  {
    icon: Activity,
    title: 'Performance & wellness',
    body: 'Performance charts and wellness check-ins on each student profile.',
    href: '/dashboard/students',
  },
]

const COLLABORATE: Feature[] = [
  {
    icon: UserRound,
    title: 'Staff & roles',
    body: 'Invite staff and assign one of 8 organization roles, from Owner to Medical.',
    href: '/dashboard/members',
    roles: MEMBERS_NAV_ROLES,
  },
  {
    icon: Link2,
    title: 'Share links',
    body: 'Issue a public, tokenized link to a slice of any analysis.',
    href: '/dashboard/history',
    roles: HISTORY_NAV_ROLES,
  },
  {
    icon: GraduationCap,
    title: 'Player hub',
    body: 'Players self-upload video, track KPIs and objectives, and read their own reports.',
    href: '/player',
  },
  {
    icon: Shield,
    title: 'Audit log',
    body: 'Every staff action recorded with actor, resource and result.',
    href: '/dashboard/audit',
    roles: AUDIT_NAV_ROLES,
  },
]

function visible(features: Feature[], role: OrgRole): Feature[] {
  return features.filter((f) => !f.roles || f.roles.includes(role))
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-border bg-card p-5">
      <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}

function FeatureCard({ icon: Icon, title, body, href }: Feature) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-[6px] border border-border bg-card p-5 transition-colors duration-150 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">{body}</p>
      <span className="mt-auto flex items-center gap-1 pt-4 text-meta font-medium text-primary group-hover:underline">
        Open
        <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </Link>
  )
}

function FeatureGrid({ features }: { features: Feature[] }) {
  if (features.length === 0) return null
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f) => (
        <FeatureCard key={f.title} {...f} />
      ))}
    </div>
  )
}

export default async function FeaturesPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { role } = orgCtx

  const analyze = visible(ANALYZE, role)
  const coach = visible(COACH, role)
  const collaborate = visible(COLLABORATE, role)

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Features']}
        title="Features"
        description="Everything CoachXYZ does — what you have access to today."
      />

      <div className="space-y-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} />
          ))}
        </div>

        <Section title="Analyze">
          <FeatureGrid features={analyze} />
        </Section>

        <Section title="Coach">
          <FeatureGrid features={coach} />
        </Section>

        <Section title="Collaborate">
          <FeatureGrid features={collaborate} />
        </Section>

        <div className="rounded-[6px] bg-muted p-6 text-center">
          <p className="text-base font-semibold text-foreground">New here?</p>
          <p className="mt-1.5 text-meta text-muted-foreground">
            Upload a clip and see the annotated findings for yourself.
          </p>
          <Button className="mt-4" nativeButton={false} render={<Link href="/#analyze" />}>
            Watch the upload flow
          </Button>
        </div>
      </div>
    </div>
  )
}
