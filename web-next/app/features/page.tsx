import { Check, Zap, Users, ShieldCheck, Video, BarChart3, Clock } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import Link from 'next/link'

export const metadata = { title: 'Features | CoachXYZ' }

const feats = [
  { icon: Zap, title:'6-sport AI', desc:'Basketball, football, cricket, tennis, baseball, hockey — sport-aware scoring out of the box.' },
  { icon: Video, title:'Annotated video', desc:'Pose overlays, HUD stats and coaching cues rendered frame-by-frame.' },
  { icon: Users, title:'Roster & player hub', desc:'Link analyses to athletes, track attendance, and share reports.' },
  { icon: BarChart3, title:'Reports & trends', desc:'Progress, attendance and performance reports with one click.' },
  { icon: Clock, title:'60-second pipeline', desc:'From upload to shareable report faster than a water break.' },
  { icon: ShieldCheck, title:'Privacy & scale', desc:'Scoped URLs, retention controls, and team permissions.' },
]

export default function FeaturesPage(){
  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)]">
      <section className="px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Features</p>
          <h1 className="mx-auto mt-2 max-w-[720px] text-[32px] font-bold leading-tight sm:text-[36px]">Everything you need to coach faster</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm text-[var(--marketing-beige)]/60">A complete toolkit — from capture to feedback — without stitching tools together.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feats.map(f=>(
              <div key={f.title} className="rounded-2xl border border-white/10 bg-[var(--marketing-dark-card)] p-6 text-left">
                <div className="grid size-10 place-items-center rounded-xl bg-primary text-[var(--marketing-brown)]"><f.icon className="size-5"/></div>
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--marketing-beige)]/60">{f.desc}</p>
              </div>
            ))}
          </div>
          <Button render={<Link href="/signup" />} className="mt-8 rounded-full bg-primary px-6 text-[var(--marketing-brown)] hover:bg-primary/90">Start building</Button>
        </div>
      </section>
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8 text-[var(--marketing-brown)]">
        <div className="mx-auto max-w-[1120px] grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white border border-[var(--marketing-beige)] p-6">
            <h3 className="font-bold">For coaches</h3>
            <ul className="mt-3 space-y-2 text-sm text-[var(--marketing-brown)]/70">
              <li className="flex gap-2"><Check className="size-4 text-success"/> Unlimited roster</li>
              <li className="flex gap-2"><Check className="size-4 text-success"/> Attendance & schedule</li>
              <li className="flex gap-2"><Check className="size-4 text-success"/> One-click reports</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-primary p-6 text-[var(--marketing-brown)]">
            <h3 className="font-bold">For athletes</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="size-4"/> Personal hub</li>
              <li className="flex gap-2"><Check className="size-4"/> Video + scores</li>
              <li className="flex gap-2"><Check className="size-4"/> Progress tracking</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
