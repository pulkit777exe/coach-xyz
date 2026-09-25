import type { Metadata } from 'next'
import Link from 'next/link'
import { Target, Sparkles, Users, Video } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata: Metadata = {
  title: 'About | CoachXYZ',
  description: 'Why we built CoachXYZ — AI-powered sports video analysis for coaches.',
}

const stats = [
  { value: '60s', label: 'Upload to shareable report' },
  { value: '6', label: 'Sports supported' },
  { value: '100%', label: 'Coach-owned player data' },
  { value: '3AM', label: 'When a coach finally gets to review tape' },
]

const values = [
  {
    icon: Target,
    title: 'Coach-first',
    desc: 'Every workflow starts with one question: does this save a coach time on the sideline or in the film room?',
  },
  {
    icon: Sparkles,
    title: 'Deep, not flashy',
    desc: 'AI that actually understands a sport — pose, tempo, trajectory — not generic motion clips.',
  },
  {
    icon: Users,
    title: 'Players grow, too',
    desc: 'Athletes get their own hub: their tape, their scores, their progress. Feedback lands where it matters.',
  },
]

const hairline = 'border-border'
const card =
  'rounded-[8px] border bg-background transition-colors duration-[180ms] hover:bg-surface-hover border-border hover:border-border-hover'
const eyebrow = 'text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase'
const sectionTitle =
  'text-[26px] font-bold tracking-[-0.01em] text-balance sm:text-[34px] text-foreground-strong'

export default function AboutPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-background text-foreground-strong antialiased">
      {/* ── Hero + stats ────────────────────────────────────────────────── */}
      <section className="border-b border-border px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className={eyebrow}>About</p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Coaching is the last great analog workflow
          </h1>
          <p className="mx-auto mt-4 max-w-[600px] text-balance text-[18px] leading-7 text-muted-foreground">
            CoachXYZ gives coaches the tool every other profession already has: a fast way to look
            at what happened, understand why, and share the fix.
          </p>
          <div className="mx-auto mt-12 grid max-w-[900px] grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className={`p-5 text-center ${card}`}>
                <p className="text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {s.label}
                </p>
                <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-foreground-strong">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem / what we built ─────────────────────────────────────── */}
      <section className="bg-muted px-6 py-14 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className={`rounded-[8px] border p-6 ${hairline} bg-background`}>
            <p className={eyebrow}>The problem</p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em]">
              Coaches drown in tape and spreadsheets
            </h2>
            <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
              Every match generates hours of footage, but a coach has minutes. Analysis tools are
              built for analysts — export pipelines, clip decks, manual tagging. Meanwhile the
              roster, attendance and progress reports live in five different spreadsheets.
            </p>
          </div>
          <div className="rounded-[8px] border border-primary/25 bg-primary/[0.06] p-6 dark:bg-primary/[0.09]">
            <p className="text-caption font-medium tracking-[0.08em] text-link uppercase">
              What we built
            </p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em]">
              One place, from upload to feedback
            </h2>
            <p className="mt-3 text-sm leading-[1.6] text-foreground-strong">
              Upload match or drill footage and get a sport-aware analysis in about a minute. Link
              clips to athletes, mark attendance, and turn the whole thing into a report your
              players can actually see and understand.
            </p>
          </div>
        </div>
      </section>

      {/* ── Values ──────────────────────────────────────────────────────── */}
      <section className="bg-background px-6 py-14 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <p className={`text-center ${eyebrow}`}>What we believe</p>
          <h2 className={`mt-3 text-center ${sectionTitle}`}>
            Three things we refuse to compromise on
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {values.map((v) => (
              <div key={v.title} className={`p-6 ${card}`}>
                <div className="grid size-9 place-items-center rounded-[6px] bg-primary/10 text-link">
                  <v.icon className="size-[18px]" aria-hidden />
                </div>
                <h3 className="mt-4 text-title font-semibold">{v.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-muted px-6 pb-14 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div
            className={`flex flex-col items-center justify-center rounded-[8px] border p-6 text-center ${hairline} bg-background`}
          >
            <div className="grid size-10 place-items-center rounded-[6px] bg-primary/10 text-link">
              <Video className="size-5" aria-hidden />
            </div>
            <p className="mt-3 text-title font-semibold">See the pipeline in action</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload → analysis → report, in under two minutes.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/features" />}
              variant="outline"
              className="mt-4 h-10 rounded-[6px] border-input bg-transparent px-5 text-sm font-medium text-link hover:bg-muted"
            >
              Explore features
            </Button>
          </div>
          <div className="rounded-[8px] border border-primary/25 bg-primary/[0.06] p-6 dark:bg-primary/[0.09]">
            <p className="text-caption font-medium tracking-[0.08em] text-link uppercase">
              Start free
            </p>
            <h2 className="mt-2 text-balance text-[24px] font-bold leading-tight tracking-[-0.01em] sm:text-[28px]">
              Give it one match. You&rsquo;ll feel the difference.
            </h2>
            <Button
              nativeButton={false}
              render={<Link href="/signup" />}
              className="mt-5 h-10 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Create your account
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
