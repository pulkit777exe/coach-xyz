import { Check, Zap, Users, ShieldCheck, Video, BarChart3, Clock } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import Link from 'next/link'

export const metadata = { title: 'Features | CoachXYZ' }

const feats = [
  {
    icon: Zap,
    title: '6-sport AI',
    desc: 'Basketball, football, cricket, tennis, baseball, hockey — sport-aware scoring out of the box.',
  },
  {
    icon: Video,
    title: 'Annotated video',
    desc: 'Pose overlays, HUD stats and coaching cues rendered frame-by-frame.',
  },
  {
    icon: Users,
    title: 'Roster & player hub',
    desc: 'Link analyses to athletes, track attendance, and share reports.',
  },
  {
    icon: BarChart3,
    title: 'Reports & trends',
    desc: 'Progress, attendance and performance reports with one click.',
  },
  {
    icon: Clock,
    title: '60-second pipeline',
    desc: 'From upload to shareable report faster than a water break.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy & scale',
    desc: 'Scoped URLs, retention controls, and team permissions.',
  },
]

const hairline = 'border-border'
const card =
  'rounded-[8px] border bg-background transition-colors duration-[var(--dur-base)] hover:bg-surface-hover border-border hover:border-border-hover'

export default function FeaturesPage() {
  return (
    <main id="main" tabIndex={-1} className="dark bg-[var(--marketing-dark)] text-foreground-strong antialiased bg-grid relative">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-border px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Features
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Everything you need to coach faster
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-muted-foreground">
            A complete toolkit — from capture to feedback — without stitching tools together.
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {feats.map((f) => (
              <div key={f.title} className={`p-6 ${card}`}>
                <div className="grid size-9 place-items-center rounded-[6px] bg-primary/10 text-link">
                  <f.icon className="size-[18px]" aria-hidden />
                </div>
                <h2 className="mt-4 text-title font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-body leading-6 text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/signup" />}
            className="mt-10 h-10 rounded-[6px] bg-primary px-6 text-body leading-5 font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Start building
          </Button>
        </div>
      </section>

      {/* ── For coaches / For athletes ──────────────────────────────────── */}
      <section className="bg-muted px-6 py-14 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className={`rounded-[8px] border p-6 ${hairline} bg-background`}>
            <p className="text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
              For coaches
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em]">
              One place to run it all
            </h2>
            <ul className="mt-4 space-y-2.5 text-body leading-5 text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> Unlimited roster
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> Attendance &amp; schedule
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> One-click reports
              </li>
            </ul>
          </div>
          <div className="rounded-[8px] border border-primary/25 bg-primary/[0.06] p-6 dark:bg-primary/[0.09]">
            <p className="text-label font-medium tracking-[0.08em] text-link uppercase">
              For athletes
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em]">
              Your hub, your progress
            </h2>
            <ul className="mt-4 space-y-2.5 text-body leading-5 text-foreground-strong">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> Personal hub
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> Video + scores
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-check" /> Progress tracking
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
