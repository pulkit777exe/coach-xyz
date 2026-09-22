'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { MAX_FILE_SIZE_BYTES } from '@/types'
import { Button } from '@/components/9ui/ui/button'
import { ArrowRight, Check, Play, ChevronDown } from 'lucide-react'

interface LandingPageProps {
  onFileSelected: (file: File) => void
}

export default function LandingPage({ onFileSelected }: LandingPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [subscribeEmail, setSubscribeEmail] = useState('')
  const subscribe = (e: React.FormEvent) => {
    e.preventDefault()
    const query = new URLSearchParams({ subject: 'Newsletter signup', body: subscribeEmail.trim() })
    window.location.href = `mailto:hello@coachxyz.app?${query.toString()}`
  }

  const pick = (f?: File) => {
    if (!f) return
    setFileError(null)
    if (!f.type.startsWith('video/')) {
      setFileError('Please select a video file (MP4, MOV, AVI, MKV).')
      return
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      setFileError('File exceeds 500 MB limit.')
      return
    }
    setFileName(f.name)
    onFileSelected(f)
  }
  const open = () => fileInputRef.current?.click()

  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)] antialiased selection:bg-primary/30 selection:text-[var(--marketing-white)]">
      {/* ── Hero — Auth0 purple gradient ─────────────────────────────────── */}
      <section className="marketing-hero relative overflow-hidden px-6 pb-10 pt-12 lg:px-8">
        {/* glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/2 h-[900px] w-[1200px] -translate-x-1/2 rounded-full bg-[var(--marketing-purple)]/20 blur-[120px]" />
          <div className="absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-[var(--marketing-orange)]/15 blur-[100px]" />
          <div className="absolute -bottom-20 -left-40 h-[500px] w-[500px] rounded-full bg-[var(--marketing-violet)]/10 blur-[90px]" />
        </div>
        <div className="relative mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[780px] text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--marketing-purple-light)]">
              AI-POWERED COACHING
            </p>
            <h1 className="mt-4 text-balance text-[32px] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--marketing-white)] sm:text-[44px] lg:text-[52px]">
              Analyze, protect
              <br />& elevate every
              <br />
              <span className="bg-gradient-to-r from-primary to-[var(--marketing-green)] bg-clip-text text-transparent">
                athlete&apos;s journey
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-[640px] text-[15px] leading-6 text-[var(--marketing-white)]/60">
              CoachXYZ makes high-performance video analysis effortless — from upload to annotated
              video and shareable reports. Six sports, one pipeline, under 60 seconds.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button
                onClick={open}
                className="h-10 rounded-full bg-[var(--marketing-white)] px-6 text-sm font-semibold text-[var(--marketing-dark)] hover:bg-[var(--marketing-white)]/90"
              >
                Start analyzing for free
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  document.getElementById('analyze')?.scrollIntoView({ behavior: 'smooth' })
                }
                className="h-10 rounded-full border-[var(--marketing-white)]/20 bg-[var(--marketing-white)]/5 px-6 text-sm text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]/10 hover:text-[var(--marketing-white)]"
              >
                Talk to an expert
              </Button>
            </div>
          </div>

          {/* device previews — glass */}
          <div className="mt-10 flex justify-center gap-3 overflow-x-auto pb-2">
            {[
              { k: 'Analysis', d: 'Form 8.4 → 6.2' },
              { k: 'Scores', d: 'Confidence 92%' },
              { k: 'Chat', d: 'Ask about reps' },
              { k: 'Video', d: 'Pose overlays' },
              { k: 'Report', d: 'Share link' },
            ].map((x, i) => (
              <div
                key={x.k}
                className={`flex h-[200px] w-[144px] shrink-0 snap-center rounded-[20px] border bg-[var(--marketing-white)]/[0.06] p-3 backdrop-blur-xl ${i === 2 ? 'scale-[1.06] border-[var(--marketing-white)]/15 bg-[var(--marketing-white)]/[0.08] shadow-[0_8px_32px_rgba(124,58,237,0.25)]' : 'border-[var(--marketing-white)]/10'}`}
              >
                <div className="w-full rounded-xl bg-[var(--marketing-dark)]/60 p-2.5 border border-[var(--marketing-white)]/5">
                  <div className="mx-auto mb-3 h-1.5 w-8 rounded-full bg-[var(--marketing-white)]/10" />
                  <p className="text-[11px] font-semibold text-[var(--marketing-white)]">{x.k}</p>
                  <p className="text-[10px] text-[var(--marketing-white)]/50">{x.d}</p>
                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 rounded bg-primary/30" />
                    <div className="h-1.5 rounded bg-[var(--marketing-white)]/5 w-3/4" />
                    <div className="mt-3 h-14 rounded-lg bg-[var(--marketing-white)]/10 border border-[var(--marketing-white)]/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* trusted by */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 border-t border-[var(--marketing-white)]/10 pt-6 text-[11px] font-bold tracking-[0.16em] text-[var(--marketing-white)]/25">
            <span>TRUSTED BY COACHES AT</span>
            {['Academy FC', 'Elite Hoops', 'State Cricket', 'Hockey Pro'].map((s) => (
              <span
                key={s}
                className="font-semibold tracking-widest text-[var(--marketing-white)]/35"
              >
                {s.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar — Auth0 3-col ─────────────────────────────────────── */}
      <section className="border-y border-[var(--marketing-white)]/10 bg-[var(--marketing-dark)] px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 divide-y divide-[var(--marketing-white)]/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { k: '500K+', l: 'analyses delivered', d: 'Across 6 sports and thousands of sessions' },
            { k: '99.99%', l: 'pipeline uptime', d: 'Gemini + MediaPipe, built to scale' },
            { k: '60s', l: 'median turnaround', d: 'Upload to annotated video & report' },
          ].map((s) => (
            <div key={s.k} className="px-6 py-6 text-center sm:py-7">
              <p className="text-[28px] font-bold tracking-tight text-[var(--marketing-white)]">
                {s.k}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]/60">
                {s.l}
              </p>
              <p className="mt-1 text-xs text-[var(--marketing-white)]/35">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Identity for entire lifecycle — semicircular ─────────────────── */}
      <section className="relative overflow-hidden bg-[var(--marketing-dark)] px-6 py-12 lg:px-8">
        <div className="absolute inset-0 bg-[var(--marketing-hero)] opacity-40" />
        <div className="relative mx-auto max-w-[1120px] text-center">
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--marketing-white)] sm:text-[26px]">
            Intelligence for the entire athlete lifecycle
          </h2>
          <div className="mx-auto mt-8 max-w-[720px] rounded-[24px] border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-8 backdrop-blur-xl">
            <div className="relative mx-auto h-[180px] w-full max-w-[560px]">
              <div className="absolute inset-x-12 bottom-0 top-6 rounded-t-[280px] border border-[var(--marketing-white)]/10 border-b-0 bg-gradient-to-b from-[var(--marketing-purple)]/15 to-transparent" />
              <div className="absolute left-1/2 top-6 h-[140px] w-[1px] -translate-x-1/2 bg-[var(--marketing-white)]/10" />
              <div className="absolute inset-0 flex items-end justify-between px-2">
                {[
                  { l: 'Upload', sub: 'Any format' },
                  { l: 'Detect', sub: 'MediaPipe' },
                  { l: 'Analyze', sub: 'Gemini AI' },
                  { l: 'Deliver', sub: 'Video + report' },
                ].map((s) => (
                  <div key={s.l} className="flex flex-col items-center gap-2">
                    <div className="grid size-10 place-items-center rounded-full border border-[var(--marketing-white)]/15 bg-[var(--marketing-dark)] text-xs font-bold text-[var(--marketing-white)] shadow-[0_0_20px_rgba(124,58,237,0.3)]">
                      {s.l[0]}
                    </div>
                    <span className="text-xs font-semibold text-[var(--marketing-white)]">
                      {s.l}
                    </span>
                    <span className="text-[10px] text-[var(--marketing-white)]/40">{s.sub}</span>
                  </div>
                ))}
              </div>
              <div className="absolute left-1/2 top-[22%] -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-[var(--marketing-dark)]">
                Pipeline
              </div>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <Button
                onClick={open}
                className="h-8 rounded-full bg-[var(--marketing-white)] px-4 text-xs font-semibold text-[var(--marketing-dark)]"
              >
                Explore pipeline
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 reasons — dark glass ───────────────────────────────────────── */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-center text-[20px] font-bold tracking-tight text-[var(--marketing-white)]">
            4 reasons to build coaching with <span className="text-primary">CoachXYZ</span>
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: '1',
                t: 'Full-funnel',
                d: 'From upload to annotated video and shareable report — no gaps.',
              },
              {
                n: '2',
                t: 'Your workflow',
                d: 'Roster, attendance, schedule and analysis in one place.',
              },
              {
                n: '3',
                t: 'Grandparent-simple',
                d: 'Drag, drop, select player, get results. No manual tagging.',
              },
              {
                n: '4',
                t: 'Sport-aware',
                d: 'Basketball, football, cricket, tennis, baseball, hockey.',
              },
            ].map((c) => (
              <div
                key={c.n}
                className="rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-5 backdrop-blur-xl"
              >
                <div className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-[var(--marketing-dark)]">
                  {c.n}
                </div>
                <p className="mt-3 text-sm font-semibold leading-tight text-[var(--marketing-white)]">
                  {c.t}
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--marketing-white)]/55">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature blocks — Auth0 4 stacked dark cards ─────────────────── */}
      <section className="bg-[var(--marketing-dark)] px-6 pb-6 lg:px-8">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
          {[
            {
              eyebrow: 'AI AGENTS',
              title: 'Ship video analysis faster, without losing control',
              bullets: ['Govern every analysis', 'Custom sport configs', 'Policy-aware sharing'],
              cta: 'Explore pipeline',
            },
            {
              eyebrow: 'ONBOARDING',
              title: 'Drive adoption with frictionless upload',
              bullets: ['Drag & drop 500 MB', 'Auto player detection', 'Shareable Links'],
              cta: 'See upload flow',
            },
            {
              eyebrow: 'ENTERPRISE',
              title: 'Build academy-ready workflows without the headache',
              bullets: ['Roster & attendance', 'Schedule & reports', 'Player hub'],
              cta: 'Discover org tools',
            },
            {
              eyebrow: 'SCALE',
              title: 'Secure machine reviews at scale',
              bullets: ['Role-based access', 'Audit-ready exports', 'Private video URLs'],
              cta: 'View security',
            },
          ].map((f, i) => (
            <div
              key={f.title}
              className="grid gap-6 rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-6 backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr] lg:p-7"
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--marketing-purple-light)]">
                  {f.eyebrow}
                </p>
                <h3 className="mt-2 text-[18px] font-bold leading-tight text-[var(--marketing-white)]">
                  {f.title}
                </h3>
                <ul className="mt-4 space-y-1.5 text-xs text-[var(--marketing-white)]/60">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <Check className="mt-0.5 size-3.5 text-primary shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  onClick={open}
                  className="mt-5 h-8 rounded-full border-[var(--marketing-white)]/15 bg-[var(--marketing-white)]/5 px-4 text-xs font-medium text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]/10"
                >
                  {' '}
                  {f.cta} <ArrowRight className="ml-1 size-3" />{' '}
                </Button>
              </div>
              <div className="rounded-xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark)] p-3">
                <div className="aspect-[16/10] rounded-lg bg-gradient-to-br from-[var(--marketing-purple)]/20 via-[var(--marketing-violet)]/10 to-primary/10 border border-[var(--marketing-white)]/5 flex items-center justify-center">
                  <div
                    className={`h-24 w-40 rounded-xl border bg-[var(--marketing-dark)] p-3 shadow-xl ${i === 1 ? 'border-primary/20' : ''}`}
                  >
                    <div className="h-2 w-16 rounded bg-[var(--marketing-white)]/10 mx-auto" />
                    <div className="mt-3 h-2 rounded bg-primary/20" />
                    <div className="mt-2 h-2 rounded bg-[var(--marketing-white)]/5 w-3/4" />
                    <div className="mt-3 h-10 rounded bg-[var(--marketing-white)]/5 border border-[var(--marketing-white)]/5" />
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] font-medium uppercase tracking-widest text-[var(--marketing-white)]/30">
                  Preview • 60s pipeline
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Industries ───────────────────────────────────────────────────── */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-white)]">
            Built for every sport that can&apos;t afford to slow down
          </h3>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {['Basketball', 'Football', 'Cricket', 'Tennis', 'Baseball', 'Hockey'].map((s) => (
              <span
                key={s}
                className="rounded-full border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] px-3 py-1 text-xs font-medium text-[var(--marketing-white)]/70"
              >
                {s}
              </span>
            ))}
          </div>
          <div className="mt-6 grid gap-4 rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-6 backdrop-blur-xl lg:grid-cols-[280px_1fr]">
            <div className="rounded-xl bg-[var(--marketing-dark)] p-4 border border-[var(--marketing-white)]/5">
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--marketing-purple-light)]">
                Featured
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--marketing-white)]">
                Academy sprint analysis
              </p>
              <p className="mt-1 text-xs text-[var(--marketing-white)]/50">
                U16 squad cut review time 37% in 3 weeks.
              </p>
              <div className="mt-3 flex gap-4 text-xs">
                <span>
                  <strong className="text-primary">74%</strong> faster
                </span>
                <span>
                  <strong className="text-primary">32%</strong> attendance up
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-[var(--marketing-purple)]/15 to-transparent p-5 border border-[var(--marketing-white)]/5">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]/60">
                Why coaches choose CoachXYZ
              </p>
              <ul className="mt-3 space-y-2 text-xs text-[var(--marketing-white)]/60">
                <li className="flex gap-2">
                  <Check className="size-3.5 text-primary" /> Event timeline for every rep
                </li>
                <li className="flex gap-2">
                  <Check className="size-3.5 text-primary" /> Session summary with strengths & fixes
                </li>
                <li className="flex gap-2">
                  <Check className="size-3.5 text-primary" /> Annotated video renders
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrate in minutes — code block ───────────────────────────── */}
      <section className="relative overflow-hidden bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="absolute -right-32 top-20 h-[400px] w-[400px] rounded-full bg-[var(--marketing-orange)]/15 blur-[80px]" />
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-white)]">
            Integrate video analysis into any stack in minutes
          </h3>
          <div className="mx-auto mt-6 max-w-[760px] overflow-hidden rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark)]">
            <div className="flex items-center gap-2 border-b border-[var(--marketing-white)]/10 px-4 py-2">
              <span className="size-2.5 rounded-full bg-destructive/60" />
              <span className="size-2.5 rounded-full bg-warning/60" />
              <span className="size-2.5 rounded-full bg-success/60" />
              <span className="ml-3 text-xs font-medium text-[var(--marketing-white)]/40">
                POST /api/analyze-video
              </span>
            </div>
            <pre className="overflow-x-auto p-4 text-xs leading-5 text-[var(--marketing-white)]/70">
              <code>{`curl -X POST https://api.coachxyz.app/analyze-video \\
  -H "Authorization: Bearer COACH_API_KEY" \\
  -F video=@training.mp4 \\
  -F sport=basketball \\
  -F player_id=player_123

# → { "job_id": "xyz_123", "status": "processing", "eta": "45s" }`}</code>
            </pre>
            <div className="flex gap-2 border-t border-[var(--marketing-white)]/10 px-4 py-2">
              <Button
                size="sm"
                className="h-7 rounded-full bg-[var(--marketing-white)] px-3 text-xs font-semibold text-[var(--marketing-dark)]"
              >
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-full border-[var(--marketing-white)]/15 text-[var(--marketing-white)]"
              >
                Docs
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Results — white ─────────────────────────────────────────────── */}
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-[18px] font-bold text-[var(--marketing-dark)]">
            As you can see, we get <span className="text-[var(--marketing-purple)]">results</span>
          </h3>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: '37%', d: 'faster review loops on average' },
              { k: '22%', d: 'higher attendance after 4 weeks' },
              { k: '17%', d: 'form score improvement (median)' },
              { k: '246%', d: 'more video feedback shared per month' },
            ].map((s) => (
              <div
                key={s.k}
                className="rounded-2xl bg-[var(--marketing-dark)] p-6 text-center border border-[var(--marketing-dark)]"
              >
                <p className="text-[28px] font-bold tracking-tight text-primary">{s.k}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--marketing-white)]/60">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What happens — dark vertical timeline ────────────────────────── */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-white)]">
            What happens after you upload
          </h3>
          <div className="relative mx-auto mt-8 max-w-[760px]">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-primary via-[var(--marketing-purple)] to-[var(--marketing-orange)]/40 sm:left-1/2 sm:-translate-x-px" />
            {[
              {
                n: '1',
                t: 'Upload your clip',
                d: 'Drag MP4/MOV/AVI up to 500 MB. Auto-validated.',
              },
              {
                n: '2',
                t: 'We detect every athlete',
                d: 'MediaPipe finds each player with boxes + confidence.',
              },
              {
                n: '3',
                t: 'Gemini scores & corrects',
                d: 'Form, mechanics and timing across keyframes.',
              },
              {
                n: '4',
                t: 'You get annotated video',
                d: 'Pose overlays, HUD stats, coaching cues.',
              },
              { n: '5', t: 'Share & track progress', d: 'Link to roster, reports and trends.' },
            ].map((s, i) => (
              <div
                key={s.n}
                className={`relative flex gap-4 py-6 ${i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse'}`}
              >
                <div className={`flex-1 ${i % 2 === 0 ? 'sm:text-right' : ''}`}>
                  <div
                    className={`rounded-xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-4 backdrop-blur-xl ${i % 2 === 0 ? 'sm:ml-auto' : ''} sm:max-w-[320px]`}
                  >
                    <p className="text-sm font-semibold text-[var(--marketing-white)]">
                      {s.n}. {s.t}
                    </p>
                    <p className="mt-1 text-xs text-[var(--marketing-white)]/55">{s.d}</p>
                  </div>
                </div>
                <div className="absolute left-4 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-xs font-bold text-[var(--marketing-dark)] sm:left-1/2">
                  {s.n}
                </div>
                <div className="flex-1 hidden sm:block" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── analyze dropzone ─────────────────────────────────────────────── */}
      <section id="analyze" className="bg-[var(--marketing-dark)] px-6 pb-8 lg:px-8">
        <div className="mx-auto max-w-[760px] rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-6 backdrop-blur-xl">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-white)]">
            Drop your training video here
          </h3>
          <p className="text-center text-sm text-[var(--marketing-white)]/50">
            Six sports • Auto player detection • 60s analysis
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              setIsDragging(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              pick(e.dataTransfer.files[0])
            }}
            className={`mt-5 flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${isDragging ? 'border-primary bg-primary/10' : 'border-[var(--marketing-white)]/10 bg-[var(--marketing-dark)] hover:border-primary/30'}`}
          >
            <input
              ref={fileInputRef}
              id="analyze-file"
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <div className="grid size-12 place-items-center rounded-full bg-primary text-[var(--marketing-dark)]">
              <Play className="size-5 translate-x-[1px]" />
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--marketing-white)]">
              {fileName || 'Drop video or click to browse'}
            </p>
            <p className="text-xs text-[var(--marketing-white)]/40">MP4, MOV, AVI • 500 MB max</p>
            <Button
              size="sm"
              onClick={open}
              className="mt-4 rounded-full bg-primary px-6 text-xs font-semibold text-[var(--marketing-dark)] hover:bg-primary/90"
            >
              Choose video
            </Button>
            {fileError && (
              <p role="alert" className="mt-2 text-xs text-red-400">
                {fileError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* testimonials — dark glass */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-white)]">
            What coaches say
          </h3>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                q: 'CoachXYZ cut our review time in half. Players get precise fixes same day.',
                a: 'David R., Performance Coach',
              },
              {
                q: 'The parent feedback loop is now async — we share reports, they see progress.',
                a: 'Ana M., Academy Director',
              },
              {
                q: 'Attendance + video in one place. No more spreadsheets.',
                a: 'James L., Head Coach',
              },
            ].map((c) => (
              <div
                key={c.q}
                className="rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/[0.04] p-5 backdrop-blur-xl"
              >
                <p className="text-sm leading-6 text-[var(--marketing-white)]/80">“{c.q}”</p>
                <p className="mt-3 text-xs text-[var(--marketing-white)]/35">— {c.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — white */}
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[760px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-dark)]">
            Frequently Asked Questions
          </h3>
          <div className="mt-6 divide-y divide-[var(--marketing-dark)]/10">
            {[
              {
                q: 'Why is AI analysis your personal platform to develop coaching?',
                a: 'Every rep is scored, timestamped and explained — no manual tagging.',
              },
              {
                q: 'How do I use the embedded analytics dashboard?',
                a: 'Connect roster, schedule sessions, and generate reports in one click.',
              },
              {
                q: 'How is feedback personal for the student?',
                a: 'Linked player hub shows only that athlete’s video, scores and reports.',
              },
            ].map((f, i) => (
              <div key={f.q} className="py-4">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-${i}`}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-medium text-[var(--marketing-dark)]">{f.q}</span>
                  <ChevronDown
                    className={`size-4 text-[var(--marketing-purple)] transition ${openFaq === i ? 'rotate-180' : ''}`}
                  />
                </button>
                {openFaq === i && (
                  <p
                    id={`faq-${i}`}
                    className="mt-2 text-sm leading-6 text-[var(--marketing-dark)]/60"
                  >
                    {f.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final CTA — split */}
      <section className="bg-[var(--marketing-light)] px-6 pb-8 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-primary p-6">
            <h3 className="text-lg font-bold leading-tight text-[var(--marketing-dark)]">
              Ready to make your
              <br />
              training more efficient?
            </h3>
            <Button
              onClick={open}
              className="mt-4 rounded-full bg-[var(--marketing-dark)] px-5 text-xs font-semibold text-[var(--marketing-white)] hover:bg-foreground"
            >
              Start for free
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[var(--marketing-dark)] p-6 text-center border border-[var(--marketing-dark)]">
            <p className="text-sm font-semibold text-[var(--marketing-white)]">
              Not ready to buy yet?
            </p>
            <p className="text-xs text-[var(--marketing-white)]/50">
              Book a call with our coaching specialist
            </p>
            <Button
              variant="outline"
              render={<Link href="/contact" />}
              className="mt-3 rounded-full border-[var(--marketing-white)]/15 text-[var(--marketing-white)] hover:bg-[var(--marketing-white)]/5"
            >
              Book a call
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-[var(--marketing-dark)] px-6 py-8 lg:px-8 border-t border-[var(--marketing-white)]/5">
        <div className="mx-auto grid max-w-[1120px] gap-8 md:grid-cols-4">
          <div>
            <p className="text-sm font-bold text-[var(--marketing-white)]">coach.xyz</p>
            <p className="mt-2 max-w-[280px] text-xs leading-5 text-[var(--marketing-white)]/30">
              AI-powered sports video analysis for coaches who want faster feedback.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]">
              Platform
            </p>
            <div className="mt-3 space-y-2 text-xs text-[var(--marketing-white)]/40">
              <Link href="/features" className="block hover:text-[var(--marketing-white)]">
                Workflow
              </Link>
              <Link href="/features" className="block hover:text-[var(--marketing-white)]">
                Features
              </Link>
              <Link href="/pricing" className="block hover:text-[var(--marketing-white)]">
                Pricing
              </Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]">
              Company
            </p>
            <div className="mt-3 space-y-2 text-xs text-[var(--marketing-white)]/40">
              <Link href="/about" className="block hover:text-[var(--marketing-white)]">
                About
              </Link>
              <Link href="/blog" className="block hover:text-[var(--marketing-white)]">
                Blog
              </Link>
              <Link href="/contact" className="block hover:text-[var(--marketing-white)]">
                Contact
              </Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-white)]">
              Get updates
            </p>
            <form onSubmit={subscribe} className="mt-3 flex gap-2">
              <input
                value={subscribeEmail}
                onChange={(e) => setSubscribeEmail(e.target.value)}
                type="email"
                required
                placeholder="you@academy.com"
                className="h-8 flex-1 rounded-full border border-[var(--marketing-white)]/10 bg-[var(--marketing-white)]/5 px-3 text-xs text-[var(--marketing-white)] placeholder:text-[var(--marketing-white)]/20"
              />
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-full bg-primary px-4 text-xs font-semibold text-[var(--marketing-dark)]"
              >
                Subscribe
              </Button>
            </form>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-[1120px] items-center justify-between border-t border-[var(--marketing-white)]/5 pt-6 text-xs text-[var(--marketing-white)]/20">
          <span>© {new Date().getFullYear()} CoachXYZ</span>
          <span className="flex gap-3">
            <Link href="/privacy" className="hover:text-[var(--marketing-white)]">
              Privacy
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-[var(--marketing-white)]">
              Terms
            </Link>
          </span>
        </div>
      </footer>
    </main>
  )
}
