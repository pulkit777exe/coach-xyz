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

const hairline =
  'border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]'
const card =
  'rounded-[8px] border bg-white transition-colors duration-[180ms] hover:bg-[#fafafa] dark:bg-[#191919] dark:hover:bg-[#1e1e1e] border-[rgba(55,53,47,0.09)] hover:border-[rgba(55,53,47,0.18)] dark:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.16)]'

export default function FeaturesPage() {
  return (
    <main className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-[rgba(55,53,47,0.09)] px-6 py-16 lg:px-8 dark:border-[rgba(255,255,255,0.08)]">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
            Features
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Everything you need to coach faster
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-[#787774] dark:text-[#9b9b9b]">
            A complete toolkit — from capture to feedback — without stitching tools together.
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {feats.map((f) => (
              <div key={f.title} className={`p-6 ${card}`}>
                <div className="grid size-9 place-items-center rounded-[6px] bg-[#2383e2]/10 text-[#2383e2] dark:text-[#4da3ec]">
                  <f.icon className="size-[18px]" aria-hidden />
                </div>
                <h2 className="mt-4 text-[15px] font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-sm leading-6 text-[#787774] dark:text-[#9b9b9b]">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/signup" />}
            className="mt-10 h-10 rounded-[6px] bg-[#2383e2] px-6 text-sm font-medium text-white hover:bg-[#1b6fb8]"
          >
            Start building
          </Button>
        </div>
      </section>

      {/* ── For coaches / For athletes ──────────────────────────────────── */}
      <section className="bg-[#f7f7f5] px-6 py-14 lg:px-8 dark:bg-[#202020]">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className={`rounded-[8px] border p-6 ${hairline} bg-white dark:bg-[#191919]`}>
            <p className="text-[11px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
              For coaches
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em]">One place to run it all</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-[#787774] dark:text-[#9b9b9b]">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> Unlimited roster
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> Attendance &amp;
                schedule
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> One-click reports
              </li>
            </ul>
          </div>
          <div className="rounded-[8px] border border-[#2383e2]/25 bg-[#2383e2]/[0.06] p-6 dark:bg-[#2383e2]/[0.09]">
            <p className="text-[11px] font-medium tracking-[0.08em] text-[#2383e2] uppercase dark:text-[#4da3ec]">
              For athletes
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em]">Your hub, your progress</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-[#37352f] dark:text-[#ececec]">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> Personal hub
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> Video + scores
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" /> Progress tracking
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
