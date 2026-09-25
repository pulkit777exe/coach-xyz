import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

import { getSession } from '@/lib/session'
import { unstable_noStore as noStore } from 'next/cache'
import { Button } from '@/components/9ui/ui/button'
import PageHeader from '@/components/org/PageHeader'
import Section from '@/components/org/Section'

export const metadata: Metadata = {
  title: 'Help | CoachXYZ',
  description: 'Guides, answers, and keyboard shortcuts for CoachXYZ.',
}

// FAQ adapted from the marketing landing FAQ (in-app copy — not imported there).
const FAQS = [
  {
    q: 'Why is AI analysis your personal platform to develop coaching?',
    a: 'Every rep is scored, timestamped and explained — no manual tagging. Findings land on the exact moment in the clip with timestamp pills, so feedback stays tied to what actually happened.',
  },
  {
    q: 'How do I use the embedded analytics dashboard?',
    a: 'Connect your roster, schedule sessions, and generate reports in one click. Attendance, performance charts and wellness check-ins all read from the same workspace.',
  },
  {
    q: 'How is feedback personal for the student?',
    a: 'The linked player hub shows only that athlete’s video, scores and reports — self-upload, KPIs and objectives included.',
  },
]

const GET_STARTED = [
  {
    n: '1',
    title: 'Upload a clip',
    body: 'Drop in an MP4, MOV or AVI up to 500 MB — the pipeline detects every athlete automatically.',
  },
  {
    n: '2',
    title: 'Review annotated findings',
    body: 'Pose overlays, the findings timeline and clip markers point at the moments worth watching.',
  },
  {
    n: '3',
    title: 'Share a report',
    body: 'Generate a print-friendly report, email it to a player, or share a link straight from the analysis.',
  },
]

const SHORTCUTS = [
  { label: 'Search', combo: '⌘ / Ctrl + K' },
  { label: 'Close dialogs', combo: 'Esc' },
]

function FaqRow({ q, a, first }: { q: string; a: string; first: boolean }) {
  return (
    <details className={`group border-b border-border ${first ? 'border-t' : ''}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[4px] py-4 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p className="pb-4 pr-8 text-sm leading-relaxed text-muted-foreground">{a}</p>
    </details>
  )
}

function StepCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-[6px] border border-border bg-card p-5">
      <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-xs font-medium tabular-nums text-primary">
        {n}
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

function ShortcutRow({ label, combo }: { label: string; combo: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="text-sm text-foreground">{label}</span>
      <kbd className="rounded-[4px] bg-accent px-1.5 py-0.5 font-mono text-label text-muted-foreground">
        {combo}
      </kbd>
    </div>
  )
}

export default async function HelpPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')

  return (
    <div className="mx-auto max-w-[720px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Help']}
        title="Help"
        description="Guides, answers, and shortcuts for CoachXYZ."
      />

      <div className="space-y-8">
        <Section title="Frequently asked questions">
          <div>
            {FAQS.map((f, i) => (
              <FaqRow key={f.q} q={f.q} a={f.a} first={i === 0} />
            ))}
          </div>
        </Section>

        <Section title="Get started">
          <div className="grid gap-4 sm:grid-cols-3">
            {GET_STARTED.map((s) => (
              <StepCard key={s.n} n={s.n} title={s.title} body={s.body} />
            ))}
          </div>
        </Section>

        <Section title="Keyboard shortcuts">
          <div>
            {SHORTCUTS.map((s) => (
              <ShortcutRow key={s.combo} label={s.label} combo={s.combo} />
            ))}
          </div>
        </Section>

        <Section title="Contact support">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[6px] bg-muted p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Still stuck?</p>
              <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
                The support page lists every way to reach the CoachXYZ team.
              </p>
            </div>
            <Button size="sm" nativeButton={false} render={<Link href="/dashboard/support" />}>
              Open support page
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
