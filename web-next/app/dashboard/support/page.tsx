import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, CircleHelp, Mail, MessageSquare } from 'lucide-react'

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import PageHeader from '@/components/org/PageHeader'
import Section from '@/components/org/Section'

export const metadata: Metadata = {
  title: 'Support | CoachXYZ',
  description: 'Reach the CoachXYZ team — we answer within one business day.',
}

const CHANNELS = [
  {
    icon: Mail,
    title: 'Email',
    description: 'help@coachxyz.app — best for account, billing, and data questions.',
    cta: 'Email support',
    href: 'mailto:help@coachxyz.app',
  },
  {
    icon: MessageSquare,
    title: 'Contact form',
    description: 'A structured form on the marketing site for detailed reports.',
    cta: 'Open contact form',
    href: '/contact',
  },
  {
    icon: CircleHelp,
    title: 'Help center',
    description: 'FAQs, get-started steps, and keyboard shortcuts live there.',
    cta: 'Open the Help center',
    href: '/dashboard/help',
  },
] as const

type PrepRowProps = {
  title: string
  meta?: ReactNode
  href?: string
}

function PrepRow({ title, meta, href }: PrepRowProps) {
  const content = (
    <>
      <span className="text-body leading-5 text-foreground">{title}</span>
      <span className="flex shrink-0 items-center gap-2 text-meta text-muted-foreground">
        {meta}
        {href ? <ArrowRight className="size-3.5" aria-hidden="true" /> : null}
      </span>
    </>
  )
  const rowClass =
    'flex h-9 items-center justify-between gap-3 rounded-[4px] px-3 transition-colors duration-150'

  return (
    <li className="border-b border-border last:border-b-0">
      {href ? (
        <Link
          href={href}
          className={`${rowClass} hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
        >
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  )
}

function ChannelCard({
  icon: Icon,
  title,
  description,
  cta,
  href,
}: {
  icon: typeof Mail
  title: string
  description: string
  cta: string
  href: string
}) {
  const cardClass =
    'group flex flex-col gap-3 rounded-[6px] border border-border bg-card p-5 transition-colors duration-150 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-body leading-5 font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-meta leading-relaxed text-muted-foreground">
          {description}
        </span>
        <span className="mt-2 block text-meta font-medium text-primary group-hover:underline">
          {cta}
        </span>
      </span>
    </>
  )

  return href.startsWith('/') ? (
    <Link href={href} className={cardClass}>
      {body}
    </Link>
  ) : (
    <a href={href} className={cardClass}>
      {body}
    </a>
  )
}

export default async function SupportPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')

  return (
    <div className="mx-auto max-w-[720px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Support']}
        title="Support"
        description="Reach the CoachXYZ team — we answer within one business day."
      />

      <div className="space-y-8">
        <Section title="Ways to reach us">
          <div className="grid gap-4 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <ChannelCard key={c.title} {...c} />
            ))}
          </div>
        </Section>

        <Section title="Before you write">
          <ul>
            <PrepRow title="Check the Help center" meta="FAQs & shortcuts" href="/dashboard/help" />
            <PrepRow
              title="Search with the command palette"
              meta={
                <kbd className="rounded-[4px] bg-accent px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                  ⌘ / Ctrl + K
                </kbd>
              }
            />
            <PrepRow title="Browse Features" meta="What's included" href="/dashboard/features" />
          </ul>
        </Section>

        <div className="space-y-3">
          <p className="text-caption leading-4 text-muted-foreground">
            Support hours: Mon–Fri, 9:00–18:00 UTC
          </p>
          <p className="text-meta leading-relaxed text-muted-foreground">
            Reports, invites and attendance sheets are emailed from CoachXYZ — add us to your
            address book so they land in your inbox, not spam.
          </p>
          <p className="text-meta leading-relaxed text-muted-foreground">
            Questions about plans or trials? See{' '}
            <Link href="/pricing" className="font-medium text-primary hover:underline">
              pricing
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
