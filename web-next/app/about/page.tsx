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

const hairline = 'border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]'
const card =
  'rounded-[8px] border bg-white transition-colors duration-[180ms] hover:bg-[#fafafa] dark:bg-[#191919] dark:hover:bg-[#1e1e1e] border-[rgba(55,53,47,0.09)] hover:border-[rgba(55,53,47,0.18)] dark:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.16)]'
const eyebrow =
  'text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]'
const sectionTitle =
  'text-[26px] font-bold tracking-[-0.01em] text-balance sm:text-[34px] text-[#37352f] dark:text-[#ececec]'

export default function AboutPage() {
  return (
    <main className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* ── Hero + stats ────────────────────────────────────────────────── */}
      <section className="border-b border-[rgba(55,53,47,0.09)] px-6 py-16 lg:px-8 dark:border-[rgba(255,255,255,0.08)]">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className={eyebrow}>About</p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Coaching is the last great analog workflow
          </h1>
          <p className="mx-auto mt-4 max-w-[600px] text-balance text-[18px] leading-7 text-[#787774] dark:text-[#9b9b9b]">
            CoachXYZ gives coaches the tool every other profession already has: a fast way to look
            at what happened, understand why, and share the fix.
          </p>
          <div className="mx-auto mt-12 grid max-w-[900px] grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className={`p-5 text-center ${card}`}>
                <p className="text-[11px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
                  {s.label}
                </p>
                <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-[#37352f] dark:text-[#ececec]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem / what we built ─────────────────────────────────────── */}
      <section className="bg-[#f7f7f5] px-6 py-14 lg:px-8 dark:bg-[#202020]">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className={`rounded-[8px] border p-6 ${hairline} bg-white dark:bg-[#191919]`}>
            <p className={eyebrow}>The problem</p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em]">
              Coaches drown in tape and spreadsheets
            </h2>
            <p className="mt-3 text-sm leading-[1.6] text-[#787774] dark:text-[#9b9b9b]">
              Every match generates hours of footage, but a coach has minutes. Analysis tools are
              built for analysts — export pipelines, clip decks, manual tagging. Meanwhile the
              roster, attendance and progress reports live in five different spreadsheets.
            </p>
          </div>
          <div className="rounded-[8px] border border-[#2383e2]/25 bg-[#2383e2]/[0.06] p-6 dark:bg-[#2383e2]/[0.09]">
            <p className="text-[12px] font-medium tracking-[0.08em] text-[#2383e2] uppercase dark:text-[#4da3ec]">
              What we built
            </p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em]">
              One place, from upload to feedback
            </h2>
            <p className="mt-3 text-sm leading-[1.6] text-[#37352f] dark:text-[#ececec]">
              Upload match or drill footage and get a sport-aware analysis in about a minute. Link
              clips to athletes, mark attendance, and turn the whole thing into a report your
              players can actually see and understand.
            </p>
          </div>
        </div>
      </section>

      {/* ── Values ──────────────────────────────────────────────────────── */}
      <section className="bg-white px-6 py-14 lg:px-8 dark:bg-[#191919]">
        <div className="mx-auto max-w-[1120px]">
          <p className={`text-center ${eyebrow}`}>What we believe</p>
          <h2 className={`mt-3 text-center ${sectionTitle}`}>
            Three things we refuse to compromise on
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {values.map((v) => (
              <div key={v.title} className={`p-6 ${card}`}>
                <div className="grid size-9 place-items-center rounded-[6px] bg-[#2383e2]/10 text-[#2383e2] dark:text-[#4da3ec]">
                  <v.icon className="size-[18px]" aria-hidden />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold">{v.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-[#787774] dark:text-[#9b9b9b]">
                  {v.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-[#f7f7f5] px-6 pb-14 lg:px-8 dark:bg-[#202020]">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div
            className={`flex flex-col items-center justify-center rounded-[8px] border p-6 text-center ${hairline} bg-white dark:bg-[#191919]`}
          >
            <div className="grid size-10 place-items-center rounded-[6px] bg-[#2383e2]/10 text-[#2383e2] dark:text-[#4da3ec]">
              <Video className="size-5" aria-hidden />
            </div>
            <p className="mt-3 text-[15px] font-semibold">See the pipeline in action</p>
            <p className="mt-1 text-sm text-[#787774] dark:text-[#9b9b9b]">
              Upload → analysis → report, in under two minutes.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/features" />}
              variant="outline"
              className="mt-4 h-10 rounded-[6px] border-[rgba(55,53,47,0.15)] bg-transparent px-5 text-sm font-medium text-[#2383e2] hover:bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.15)] dark:text-[#4da3ec] dark:hover:bg-[#202020]"
            >
              Explore features
            </Button>
          </div>
          <div className="rounded-[8px] border border-[#2383e2]/25 bg-[#2383e2]/[0.06] p-6 dark:bg-[#2383e2]/[0.09]">
            <p className="text-[12px] font-medium tracking-[0.08em] text-[#2383e2] uppercase dark:text-[#4da3ec]">
              Start free
            </p>
            <h2 className="mt-2 text-balance text-[24px] font-bold leading-tight tracking-[-0.01em] sm:text-[28px]">
              Give it one match. You&rsquo;ll feel the difference.
            </h2>
            <Button
              nativeButton={false}
              render={<Link href="/signup" />}
              className="mt-5 h-10 rounded-[6px] bg-[#2383e2] px-5 text-sm font-medium text-white hover:bg-[#1b6fb8]"
            >
              Create your account
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
