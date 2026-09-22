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

export default function AboutPage() {
  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)]">
      <section className="border-b border-[var(--marketing-white)]/5 px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
            About
          </p>
          <h1 className="mx-auto mt-2 max-w-[720px] text-[32px] font-bold leading-tight tracking-tight sm:text-[36px]">
            Coaching is the last
            <br />
            great analog workflow
          </h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-[var(--marketing-beige)]/60">
            CoachXYZ gives coaches the tool every other profession already has: a fast way to look
            at what happened, understand why, and share the fix.
          </p>
          <div className="mx-auto mt-10 grid max-w-[900px] grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-5"
              >
                <p className="text-2xl font-bold tracking-tight text-primary">{s.value}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--marketing-beige)]/50">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8 text-[var(--marketing-brown)]">
        <div className="mx-auto grid max-w-[1120px] gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-[var(--marketing-white)] p-6 border border-[var(--marketing-beige)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
              The problem
            </p>
            <h2 className="mt-2 text-lg font-bold">Coaches drown in tape and spreadsheets</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--marketing-brown)]/70">
              Every match generates hours of footage, but a coach has minutes. Analysis tools are
              built for analysts — export pipelines, clip decks, manual tagging. Meanwhile the
              roster, attendance and progress reports live in five different spreadsheets.
            </p>
          </div>
          <div className="rounded-2xl bg-primary p-6 text-[var(--marketing-brown)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">What we built</p>
            <h2 className="mt-2 text-lg font-bold">One place, from upload to feedback</h2>
            <p className="mt-2 text-sm leading-6">
              Upload match or drill footage and get a sport-aware analysis in about a minute. Link
              clips to athletes, mark attendance, and turn the whole thing into a report your
              players can actually see and understand.
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
            What we believe
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {values.map((v) => (
              <div
                key={v.title}
                className="rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-6"
              >
                <div className="grid size-10 place-items-center rounded-xl bg-primary text-[var(--marketing-brown)]">
                  <v.icon className="size-5" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{v.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--marketing-beige)]/60">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--marketing-light)] px-6 pb-10 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[var(--marketing-dark-card)] p-6 text-center border border-[var(--marketing-dark-card)]">
            <Video className="size-10 text-primary" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-[var(--marketing-beige)]">
              See the pipeline in action
            </p>
            <p className="text-xs text-[var(--marketing-beige)]/60">
              Upload → analysis → report, in under two minutes.
            </p>
            <Button
              render={<Link href="/features" />}
              variant="outline"
              className="mt-3 rounded-full border-[var(--marketing-beige)]/20 text-[var(--marketing-beige)] hover:bg-[var(--marketing-white)]/5"
            >
              Explore features
            </Button>
          </div>
          <div className="rounded-2xl bg-primary p-6 text-[var(--marketing-brown)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Start free</p>
            <h3 className="mt-2 text-lg font-bold leading-tight">
              Give it one match.
              <br />
              You’ll feel the difference.
            </h3>
            <Button
              render={<Link href="/signup" />}
              className="mt-4 rounded-full bg-[var(--marketing-brown)] px-5 text-xs font-semibold text-[var(--marketing-beige)] hover:bg-foreground"
            >
              Create your account
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
