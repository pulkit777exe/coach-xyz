'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'
import { Monitor, Code, Terminal, Zap, Shield, ClipboardList, Users, Smartphone, Cpu, Globe, Link as LinkIcon } from 'lucide-react'

export default function MarketingLanding() {
  const [subscribeEmail, setSubscribeEmail] = useState('')
  const subscribe = (e: React.FormEvent) => {
    e.preventDefault()
    const query = new URLSearchParams({ subject: 'Newsletter signup', body: subscribeEmail.trim() })
    window.location.href = `mailto:hello@coachxyz.app?${query.toString()}`
  }

  const MARKETING_LINKS = [
    { href: '/features', label: 'Features' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/blog', label: 'Blog' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ] as const

  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)] antialiased selection:bg-primary/30 selection:text-[var(--marketing-white)]">
      {/* ── Top header ── */}
      <header className="sticky top-0 z-50 border-b border-[var(--marketing-white)]/5 bg-[var(--marketing-dark)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--marketing-dark)]/70">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-[var(--marketing-brown)] text-xs font-bold">
              C
            </span>
            <span className="text-sm font-bold tracking-tight text-[var(--marketing-beige)]">CoachXYZ</span>
          </Link>
          <div className="hidden items-center gap-6 text-sm md:flex">
            {MARKETING_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)] rounded-sm"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden h-8 items-center rounded-full px-4 text-sm font-medium text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)]"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-6 pb-12 pt-16 lg:px-8 lg:pt-20 lg:pb-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/2 h-[900px] w-[1200px] -translate-x-1/2 rounded-full bg-[var(--marketing-purple)]/20 blur-[120px]" />
          <div className="absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-[var(--marketing-orange)]/15 blur-[100px]" />
          <div className="absolute -bottom-20 -left-40 h-[500px] w-[500px] rounded-full bg-[var(--marketing-violet)]/10 blur-[90px]" />
        </div>
        <div className="relative mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[780px] text-center">
            <div className="inline-flex items-center rounded-full border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] px-3 py-1 text-[10px] font-semibold tracking-tight text-[var(--marketing-purple-light)] mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--marketing-purple)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--marketing-purple)]" />
              </span>
              Trusted by 1M+ athletes
            </div>
            <h1 className="mt-4 text-balance text-[32px] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--marketing-white)] sm:text-[48px] lg:text-[60px]">
              Analyze, protect
              <br />& elevate every
              <br />
              <span className="bg-gradient-to-r from-primary to-[var(--marketing-green)] bg-clip-text text-transparent">
                athlete&apos;s journey
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-[640px] text-[16px] leading-7 text-[var(--marketing-white)]/60">
              CoachXYZ makes high-performance video analysis effortless — from upload to annotated
              video and shareable reports. Six sports, one pipeline, under 60 seconds.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button
                nativeButton={false} render={<Link href="/dashboard" />}
                className="h-11 rounded-full bg-[var(--marketing-white)] px-7 text-sm font-semibold text-[var(--marketing-dark)] shadow-lg"
              >
                Start analyzing →
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full border-[var(--marketing-white)]/15 px-7 text-sm font-semibold text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]/5"
              >
                <a href="/features">Explore features</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product cards ── */}
      <section className="px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <div className="grid gap-4 md:gap-6 lg:grid-cols-4">
            {[
              {
                tag: 'Desktop',
                tagColor: 'bg-blue-500/10 text-blue-400',
                title: 'Coach Desktop',
                desc: 'The video analysis agent as a native desktop app. No editor required.',
                cta: 'Download for Mac',
                icon: Monitor,
              },
              {
                tag: 'IDE',
                tagColor: 'bg-red-500/10 text-red-400',
                title: 'Coach IDE Extension',
                desc: 'Install the Coach extension in your editor of choice.',
                cta: 'Install extension',
                icon: Code,
              },
              {
                tag: 'CLI',
                tagColor: 'bg-purple-500/10 text-purple-400',
                title: 'Coach CLI',
                desc: 'From prompt to production, right inside your terminal.',
                cta: 'View docs',
                icon: Terminal,
              },
              {
                tag: 'SDK',
                tagColor: 'bg-green-500/10 text-green-400',
                title: 'Coach SDK',
                desc: 'Embed the analysis runtime that powers Coach in your own apps.',
                cta: 'View docs',
                icon: Cpu,
              },
            ].map((p) => (
              <div
                key={p.title}
                className="rounded-xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-6 backdrop-blur-xl"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${p.tagColor}`}>
                    {p.tag[0]}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--marketing-white)] mb-2">{p.title}</h3>
                <p className="text-xs text-[var(--marketing-white)]/50 mb-6">{p.desc}</p>
                <Button
                  size="sm"
                  className="h-8 rounded-full bg-[var(--marketing-white)] px-4 text-[10px] font-bold text-[var(--marketing-dark)] tracking-wider"
                 
                >
                  <a href="/dashboard">{p.cta}</a>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trusted by ── */}
      <section className="border-y border-[var(--marketing-white)]/5 bg-[var(--marketing-dark)]/40 py-12 px-6">
        <div className="mx-auto max-w-[1120px]">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]/40 mb-8">
            Trusted by coaches and academies at
          </p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 opacity-50 grayscale hover:grayscale-0 transition-all">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="flex items-center justify-center h-12 opacity-60">
                <div className="flex items-center gap-1 text-xs font-bold text-[var(--marketing-white)]/40 uppercase tracking-wider">
                  <div className="h-4 w-8 rounded border border-[var(--marketing-white)]/20" />
                  <span className="hidden sm:block">ACADEMY</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── See at work ── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <div className="flex flex-col lg:flex-row gap-12 items-center">
            <div className="lg:w-1/2">
              <h2 className="text-[28px] font-bold tracking-tight text-[var(--marketing-white)] leading-tight">
                See CoachXYZ at work
              </h2>
              <p className="mt-4 text-[var(--marketing-white)]/60">
                One agent across your IDE, terminal, and SDK. Pick a task and watch it run.
              </p>
              <Button
                size="sm"
                className="mt-6 h-9 rounded-full bg-[var(--marketing-white)] px-5 text-[11px] font-bold text-[var(--marketing-dark)] tracking-wider"
               
              >
                <a href="/features">Read the full docs</a>
              </Button>
            </div>
            <div className="lg:w-1/2 relative">
              <div className="rounded-xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-1 backdrop-blur-xl shadow-2xl overflow-hidden">
                <div className="relative h-[420px] bg-gradient-to-b from-[var(--marketing-dark)]/80 to-[var(--marketing-dark)]">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-[var(--marketing-dark)]">
                        <Monitor className="size-5" />
                      </div>
                      <p className="text-sm font-semibold text-[var(--marketing-white)]">Video Analysis</p>
                      <p className="text-xs text-[var(--marketing-white)]/40">Upload → Detect → Analyze → Report</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Big feature heading ── */}
      <section className="px-6 py-24 lg:px-8">
        <div className="mx-auto max-w-[780px] text-center">
          <h2 className="text-[40px] font-bold tracking-tight text-[var(--marketing-white)] leading-[1.1] lg:text-[56px]">
            Everything a coach should do,
            <br />
            in one platform.
          </h2>
          <p className="mt-6 text-[var(--marketing-white)]/60 text-lg">
            Open source. Plan-and-Act. Every model. No vendor lock-in.
          </p>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Zap,
                title: 'Full-funnel analysis',
                desc: 'From upload to annotated video and shareable report — no gaps.',
              },
              {
                icon: Shield,
                title: 'Your workflow',
                desc: 'Roster, attendance, schedule and analysis in one place.',
              },
              {
                icon: ClipboardList,
                title: 'Grandparent-simple',
                desc: 'Drag, drop, select player, get results. No manual tagging.',
              },
              {
                icon: Globe,
                title: 'Sport-aware',
                desc: 'Basketball, football, cricket, tennis, baseball, hockey.',
              },
              {
                icon: Users,
                title: 'Player hub',
                desc: 'Linked player hub shows only that athlete&apos;s video, scores and reports.',
              },
              {
                icon: Smartphone,
                title: 'Role-based access',
                desc: 'Secure sharing for coaches, athletes, and parents.',
              },
              {
                icon: LinkIcon,
                title: 'Shareable Links',
                desc: 'Generate private video URLs and reports with one click.',
              },
              {
                icon: Terminal,
                title: 'Audit-ready exports',
                desc: 'CSV, PDF, and video exports for compliance and review.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-6 backdrop-blur-xl"
              >
                <div className="flex size-9 items-center justify-center rounded-full bg-[var(--marketing-white)]/5 mb-4">
                  <f.icon className="size-5 text-[var(--marketing-purple-light)]" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--marketing-white)] mb-2">{f.title}</h3>
                <p className="text-xs text-[var(--marketing-white)]/50 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <Button
            size="sm"
            className="h-9 rounded-full bg-[var(--marketing-white)] px-6 text-[11px] font-bold text-[var(--marketing-dark)] tracking-wider shadow-lg"
           
          >
            <a href="/docs">Read the full docs →</a>
          </Button>
        </div>
      </section>

      {/* ── Infrastructure ── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <div className="grid gap-8 md:grid-cols-2 items-center">
            <div>
              <h2 className="text-[28px] font-bold tracking-tight text-[var(--marketing-white)] leading-tight mb-4">
                Any model,<br />
                your infrastructure
              </h2>
              <p className="text-[var(--marketing-white)]/60">
                CoachXYZ works with every major provider. Bring your own key, your own endpoint,
                or your own weights and keep your workflow exactly the same.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-6 md:gap-10">
              {['Gemini', 'MediaPipe', 'OpenAI', 'Anthropic', 'Local', 'Custom'].map((provider) => (
                <div
                  key={provider}
                  className="flex size-14 items-center justify-center rounded-full border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] text-[10px] font-bold text-[var(--marketing-white)]/70"
                >
                  {provider}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-16 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-8 lg:grid-cols-2">
          <div className="rounded-2xl bg-primary p-8">
            <h3 className="text-lg font-bold leading-tight text-[var(--marketing-dark)]">
              Ready to make your
              <br />
              training more efficient?
            </h3>
            <Button
              nativeButton={false} render={<Link href="/signup" />}
              className="mt-6 h-10 rounded-full bg-[var(--marketing-dark)] px-5 text-xs font-semibold text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]"
            >
              Start for free
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[var(--marketing-dark)] p-8 text-center border border-[var(--marketing-white)]/5">
            <p className="text-sm font-semibold text-[var(--marketing-white)] mb-2">
              Not ready to buy yet?
            </p>
            <p className="text-xs text-[var(--marketing-white)]/50 mb-4">
              Book a call with our coaching specialist
            </p>
            <Button
              variant="outline"
              nativeButton={false} render={<Link href="/contact" />}
              className="h-9 rounded-full border-[var(--marketing-white)]/15 px-5 text-xs font-semibold text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]/5"
            >
              Book a call
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--marketing-white)]/5 bg-[var(--marketing-dark)] px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <div className="grid gap-8 md:grid-cols-4 lg:grid-cols-5 mb-12">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <span className="grid size-6 place-items-center rounded-md bg-primary text-[var(--marketing-brown)] text-[10px] font-bold">
                  C
                </span>
                <span className="text-sm font-bold tracking-tight text-[var(--marketing-beige)]">CoachXYZ</span>
              </div>
              <p className="text-xs text-[var(--marketing-white)]/40 max-w-[280px] leading-relaxed">
                AI-powered sports video analysis for coaches who want faster feedback.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)] mb-4">
                Platform
              </p>
              <div className="space-y-2 text-xs text-[var(--marketing-white)]/50">
                {MARKETING_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} className="hover:text-[var(--marketing-white)]">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)] mb-4">
                Company
              </p>
              <div className="space-y-2 text-xs text-[var(--marketing-white)]/50">
                <Link href="/about" className="hover:text-[var(--marketing-white)]">About</Link>
                <Link href="/blog" className="hover:text-[var(--marketing-white)]">Blog</Link>
                <Link href="/contact" className="hover:text-[var(--marketing-white)]">Contact</Link>
                <Link href="/privacy" className="hover:text-[var(--marketing-white)]">Privacy</Link>
                <Link href="/terms" className="hover:text-[var(--marketing-white)]">Terms</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)] mb-4">
                Get updates
              </p>
              <form onSubmit={subscribe} className="flex gap-2">
                <input
                  value={subscribeEmail}
                  onChange={(e) => setSubscribeEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="you@academy.com"
                  className="h-9 flex-1 rounded-full border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] px-3 text-[11px] text-[var(--marketing-white)] placeholder:text-[var(--marketing-white)]/20 focus:outline-none focus:ring-1 focus:ring-[var(--marketing-purple-light)]"
                />
                <Button type="submit" size="sm" className="h-9 rounded-full bg-primary px-4 text-[10px] font-bold text-[var(--marketing-dark)] tracking-wider">
                  Subscribe
                </Button>
              </form>
            </div>
          </div>
          <div className="flex max-w-[1120px] items-center justify-between border-t border-[var(--marketing-white)]/5 pt-8 text-[10px] text-[var(--marketing-white)]/20">
            <span>© {new Date().getFullYear()} CoachXYZ</span>
            <div className="flex gap-4">
              <a href="#" className="hover:text-[var(--marketing-white)]">Privacy</a>
              <span className="text-[var(--marketing-white)]/20">•</span>
              <a href="#" className="hover:text-[var(--marketing-white)]">Terms</a>
            </div>
            <div className="flex gap-3">
              <a href="#" className="hover:text-[var(--marketing-white)]">Discord</a>
              <a href="#" className="hover:text-[var(--marketing-white)]">X</a>
              <a href="#" className="hover:text-[var(--marketing-white)]">LinkedIn</a>
              <a href="#" className="hover:text-[var(--marketing-white)]">Reddit</a>
              <a href="#" className="hover:text-[var(--marketing-white)]">GitHub</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
