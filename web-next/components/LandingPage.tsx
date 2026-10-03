'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { MAX_FILE_SIZE_BYTES } from '@/types'
import { Button } from '@/components/9ui/ui/button'
import TypewriterHighlight from '@/components/TypewriterHighlight'
import { ArrowRight, Check, Play, ChevronDown, Globe } from 'lucide-react'

interface LandingPageProps {
  onFileSelected: (file: File) => void
}

/* ── Notion palette recipes (semantic Tailwind tokens — light/dark handled by the token) ── */
const surface = 'bg-background'
const band = 'bg-muted'
const hairline = 'border-border'
const textMain = 'text-foreground-strong'
const textMuted = 'text-muted-foreground'
const eyebrow = 'text-caption font-medium uppercase tracking-[0.08em] text-muted-foreground'
const sectionTitle =
  'text-[26px] font-bold tracking-[-0.01em] text-balance sm:text-[34px] text-foreground-strong'
const card =
  'rounded-[8px] border bg-background transition-colors duration-[180ms] hover:bg-surface-hover border-border hover:border-border-hover'
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const statValue =
  'text-[30px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-foreground-strong'
const statLabel = 'text-label font-medium uppercase tracking-[0.08em] text-muted-foreground'
const footerLink = `block text-sm text-foreground transition-colors duration-[120ms] hover:text-primary hover:underline ${focusRing}`

const PREVIEW_CARDS = [
  { k: 'Analysis', d: 'Form 8.4 → 6.2' },
  { k: 'Scores', d: 'Confidence 92%' },
  { k: 'Chat', d: 'Ask about reps' },
  { k: 'Video', d: 'Pose overlays' },
  { k: 'Report', d: 'Share link' },
]

const LIFECYCLE_STEPS = [
  { l: 'Upload', sub: 'Any format' },
  { l: 'Detect', sub: 'MediaPipe' },
  { l: 'Analyze', sub: 'Gemini AI' },
  { l: 'Deliver', sub: 'Video + report' },
]

const FEATURE_BLOCKS = [
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
]

const TIMELINE_STEPS = [
  { n: '1', t: 'Upload your clip', d: 'Drag MP4/MOV/AVI up to 500 MB. Auto-validated.' },
  {
    n: '2',
    t: 'We detect every athlete',
    d: 'MediaPipe finds each player with boxes + confidence.',
  },
  { n: '3', t: 'Gemini scores & corrects', d: 'Form, mechanics and timing across keyframes.' },
  { n: '4', t: 'You get annotated video', d: 'Pose overlays, HUD stats, coaching cues.' },
  { n: '5', t: 'Share & track progress', d: 'Link to roster, reports and trends.' },
]

const FAQS = [
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
]

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Workflow' },
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'For teams',
    links: [
      { href: '/signup', label: 'Get started free' },
      { href: '/contact', label: 'Request a demo' },
      { href: '/#analyze', label: 'Analyze a video' },
    ],
  },
]

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
    <main
      id="main"
      tabIndex={-1}
      className={`antialiased selection:bg-primary/15 ${surface} ${textMain}`}
    >
      {/* ── Hero — Notion: huge centered headline, plain surface ─────────── */}
      <section className={`${surface} px-6 pt-16 pb-14 lg:px-8`}>
        <div className="mx-auto max-w-[1120px] text-center">
          <p className={eyebrow}>AI-powered coaching</p>
          <h1 className="mx-auto mt-5 max-w-[900px] text-balance text-[38px] font-bold leading-[1.05] tracking-[-0.02em] text-foreground-strong sm:text-[56px] lg:text-[68px]">
            Analyze, protect &amp; elevate every <TypewriterHighlight />
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-balance text-[18px] leading-7 text-muted-foreground lg:text-[20px]">
            CoachXYZ makes high-performance video analysis effortless — from upload to annotated
            video and shareable reports. Six sports, one pipeline, under 60 seconds.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              onClick={open}
              className="h-10 rounded-[6px] bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Start analyzing for free
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                document.getElementById('analyze')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="h-10 rounded-[6px] border-input bg-transparent px-6 text-sm font-medium text-link hover:bg-muted"
            >
              Talk to an expert
            </Button>
          </div>

          {/* product mock — hairline bordered container */}
          <div
            className={`mx-auto mt-12 max-w-[900px] rounded-[8px] border p-3 sm:p-4 ${hairline} ${surface}`}
          >
            <div className="flex justify-center gap-3 overflow-x-auto pb-1">
              {PREVIEW_CARDS.map((x) => (
                <div
                  key={x.k}
                  className={`h-[200px] w-[144px] shrink-0 rounded-[8px] border p-3 ${hairline} ${band}`}
                >
                  <div className={`h-full rounded-[6px] border p-2.5 ${hairline} ${surface}`}>
                    <div
                      className={`mx-auto mb-3 h-1.5 w-8 rounded-full ${hairline} border bg-transparent`}
                    />
                    <p className="text-label font-semibold text-foreground-strong">{x.k}</p>
                    <p className="text-[10px] text-muted-foreground">{x.d}</p>
                    <div className="mt-3 space-y-1.5">
                      <div className="h-1.5 rounded bg-primary/40" />
                      <div className="h-1.5 w-3/4 rounded bg-foreground/8 dark:bg-white/10" />
                      <div className={`mt-3 h-14 rounded-[6px] border ${hairline} bg-muted`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* trusted by — grayscale muted */}
          <div
            className={`mx-auto mt-10 flex max-w-[900px] flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t pt-6 text-label font-medium tracking-[0.12em] uppercase ${hairline} text-muted-foreground/70`}
          >
            <span>Trusted by coaches at</span>
            {['Academy FC', 'Elite Hoops', 'State Cricket', 'Hockey Pro'].map((s) => (
              <span key={s} className="font-semibold tracking-widest">
                {s.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar — label above, tabular value ───────────────────────── */}
      <section className={`border-y px-6 lg:px-8 ${band} ${hairline}`}>
        <div
          className={`mx-auto grid max-w-[1120px] grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 divide-foreground/9 dark:divide-white/8`}
        >
          {[
            { k: '500K+', l: 'analyses delivered', d: 'Across 6 sports and thousands of sessions' },
            { k: '99.99%', l: 'pipeline uptime', d: 'Gemini + MediaPipe, built to scale' },
            { k: '60s', l: 'median turnaround', d: 'Upload to annotated video & report' },
          ].map((s) => (
            <div key={s.k} className="px-6 py-7 text-center">
              <p className={statLabel}>{s.l}</p>
              <p className={`mt-2 ${statValue}`}>{s.k}</p>
              <p className={`mt-2 text-xs ${textMuted}`}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Intelligence for the entire athlete lifecycle ─────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${surface}`}>
        <div className="mx-auto max-w-[1120px] text-center">
          <p className={eyebrow}>The pipeline</p>
          <h2 className={`mt-3 ${sectionTitle}`}>Intelligence for the entire athlete lifecycle</h2>
          <div
            className={`mx-auto mt-8 max-w-[720px] rounded-[8px] border p-8 ${hairline} ${surface}`}
          >
            <div className="relative mx-auto h-[180px] w-full max-w-[560px]">
              <div className="absolute inset-x-12 top-6 bottom-0 rounded-t-[280px] border border-b-0 border-foreground/12 bg-gradient-to-b from-primary/[0.08] to-transparent dark:border-white/10 dark:from-primary/[0.10]" />
              <div className="absolute top-6 left-1/2 h-[140px] w-px -translate-x-1/2 bg-foreground/9 dark:bg-white/10" />
              <div className="absolute inset-0 flex items-end justify-between px-2">
                {LIFECYCLE_STEPS.map((s) => (
                  <div key={s.l} className="flex flex-col items-center gap-2">
                    <div
                      className={`grid size-10 place-items-center rounded-full border bg-background text-xs font-bold text-foreground-strong ${hairline}`}
                    >
                      {s.l[0]}
                    </div>
                    <span className="text-xs font-semibold text-foreground-strong">{s.l}</span>
                    <span className={`text-[10px] ${textMuted}`}>{s.sub}</span>
                  </div>
                ))}
              </div>
              <div className="absolute top-[22%] left-1/2 -translate-x-1/2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-link">
                Pipeline
              </div>
            </div>
            <div className="mt-6 flex justify-center">
              <Button
                onClick={open}
                className="h-9 rounded-[6px] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Explore pipeline
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 reasons — hairline cards on muted band ─────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${band}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>
            4 reasons to build coaching with CoachXYZ
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <div key={c.n} className={`p-6 ${card}`}>
                <div className="grid size-7 place-items-center rounded-[6px] bg-primary/10 text-meta font-semibold text-link">
                  {c.n}
                </div>
                <p className="mt-4 text-title font-semibold text-foreground-strong">{c.t}</p>
                <p className={`mt-2 text-sm leading-6 ${textMuted}`}>{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature blocks — alternating stacked cards ────────────────────── */}
      <section className={`px-6 pb-14 lg:px-8 ${surface}`}>
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
          {FEATURE_BLOCKS.map((f) => (
            <div
              key={f.title}
              className={`grid gap-6 rounded-[8px] border p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-7 ${hairline} ${surface}`}
            >
              <div>
                <p className={eyebrow}>{f.eyebrow}</p>
                <h3 className="mt-3 text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground-strong sm:text-[24px]">
                  {f.title}
                </h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-check" />
                      {b}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  onClick={open}
                  className="mt-5 h-9 rounded-[6px] border-input bg-transparent px-4 text-sm font-medium text-link hover:bg-muted"
                >
                  {f.cta} <ArrowRight className="size-3.5" />
                </Button>
              </div>
              <div className={`rounded-[8px] border p-3 ${hairline} ${band}`}>
                <div
                  className={`flex aspect-[16/10] items-center justify-center rounded-[6px] border ${hairline} ${surface}`}
                >
                  <div className={`h-24 w-40 rounded-[6px] border p-3 ${hairline} ${band}`}>
                    <div className="mx-auto h-2 w-16 rounded bg-foreground/10 dark:bg-white/10" />
                    <div className="mt-3 h-2 rounded bg-primary/40" />
                    <div className="mt-2 h-2 w-3/4 rounded bg-foreground/8 dark:bg-white/10" />
                    <div className={`mt-3 h-10 rounded-[6px] border ${hairline} bg-background`} />
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] font-medium tracking-[0.08em] text-muted-foreground/70 uppercase">
                  Preview • 60s pipeline
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Industries ───────────────────────────────────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${band}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>
            Built for every sport that can&apos;t afford to slow down
          </h2>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {['Basketball', 'Football', 'Cricket', 'Tennis', 'Baseball', 'Hockey'].map((s) => (
              <span
                key={s}
                className={`rounded-full border bg-background px-3 py-1 text-xs font-medium text-foreground ${hairline}`}
              >
                {s}
              </span>
            ))}
          </div>
          <div
            className={`mt-8 grid gap-4 rounded-[8px] border p-6 lg:grid-cols-[280px_1fr] ${hairline} ${surface}`}
          >
            <div className={`rounded-[6px] border p-4 ${hairline} ${band}`}>
              <p className="text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Featured
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground-strong">
                Academy sprint analysis
              </p>
              <p className={`mt-1 text-xs ${textMuted}`}>
                U16 squad cut review time 37% in 3 weeks.
              </p>
              <div className="mt-3 flex gap-4 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  <strong className="font-semibold text-primary">74%</strong> faster
                </span>
                <span className="text-muted-foreground">
                  <strong className="font-semibold text-primary">32%</strong> attendance up
                </span>
              </div>
            </div>
            <div className="rounded-[6px] border border-primary/20 bg-primary/[0.05] p-5 dark:bg-primary/[0.08]">
              <p className="text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Why coaches choose CoachXYZ
              </p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <Check className="size-4 shrink-0 text-check" /> Event timeline for every rep
                </li>
                <li className="flex gap-2">
                  <Check className="size-4 shrink-0 text-check" /> Session summary with strengths
                  &amp; fixes
                </li>
                <li className="flex gap-2">
                  <Check className="size-4 shrink-0 text-check" /> Annotated video renders
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrate in minutes — code block ────────────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${surface}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>
            Integrate video analysis into any stack in minutes
          </h2>
          <div
            className={`mx-auto mt-8 max-w-[760px] overflow-hidden rounded-[8px] border ${hairline} ${band}`}
          >
            <div className={`flex items-center gap-2 border-b px-4 py-2.5 ${hairline}`}>
              <span className="size-2.5 rounded-full bg-destructive/60" />
              <span className="size-2.5 rounded-full bg-warning/60" />
              <span className="size-2.5 rounded-full bg-success/60" />
              <span className={`ml-3 font-mono text-xs ${textMuted}`}>POST /api/analyze-video</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-5 text-foreground-strong/80">
              <code>{`curl -X POST https://api.coachxyz.app/analyze-video \\
  -H "Authorization: Bearer COACH_API_KEY" \\
  -F video=@training.mp4 \\
  -F sport=basketball \\
  -F player_id=player_123

# → { "job_id": "xyz_123", "status": "processing", "eta": "45s" }`}</code>
            </pre>
            <div className={`flex gap-2 border-t px-4 py-2.5 ${hairline}`}>
              <Button
                size="sm"
                className="h-8 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-[6px] border-input bg-transparent text-xs text-link hover:bg-background"
              >
                Docs
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${band}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>As you can see, we get results</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: '37%', d: 'faster review loops on average' },
              { k: '22%', d: 'higher attendance after 4 weeks' },
              { k: '17%', d: 'form score improvement (median)' },
              { k: '246%', d: 'more video feedback shared per month' },
            ].map((s) => (
              <div key={s.k} className={`p-6 text-center ${card}`}>
                <p className={statLabel}>{s.d}</p>
                <p className={`mt-2 ${statValue}`}>{s.k}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What happens after you upload — timeline ─────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${surface}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>What happens after you upload</h2>
          <div className="relative mx-auto mt-8 max-w-[760px]">
            <div className="absolute top-0 bottom-0 left-4 w-px bg-foreground/9 sm:left-1/2 sm:-translate-x-px dark:bg-white/8" />
            {TIMELINE_STEPS.map((s, i) => (
              <div
                key={s.n}
                className={`relative flex gap-4 py-6 ${i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse'}`}
              >
                <div className={`flex-1 ${i % 2 === 0 ? 'sm:text-right' : ''}`}>
                  <div
                    className={`rounded-[8px] border p-4 ${hairline} ${surface} ${i % 2 === 0 ? 'sm:ml-auto' : ''} sm:max-w-[320px]`}
                  >
                    <p className="text-sm font-semibold text-foreground-strong">
                      {s.n}. {s.t}
                    </p>
                    <p className={`mt-1 text-xs ${textMuted}`}>{s.d}</p>
                  </div>
                </div>
                <div className="absolute left-4 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-link sm:left-1/2">
                  {s.n}
                </div>
                <div className="hidden flex-1 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── analyze dropzone ─────────────────────────────────────────────── */}
      <section id="analyze" className={`px-6 pb-14 lg:px-8 ${band}`}>
        <div className={`mx-auto max-w-[760px] rounded-[8px] border p-6 ${hairline} ${surface}`}>
          <h2 className={`text-center ${sectionTitle}`}>Drop your training video here</h2>
          <p className={`mt-3 text-center text-sm ${textMuted}`}>
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
            className={`mt-5 flex min-h-[200px] flex-col items-center justify-center rounded-[8px] border-2 border-dashed p-6 text-center transition-colors duration-150 ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-input bg-background hover:border-primary/50 dark:hover:border-primary/50'
            }`}
          >
            <input
              ref={fileInputRef}
              id="analyze-file"
              type="file"
              accept="video/*"
              className="sr-only"
              // Visually hidden, but still in the tab order and still announced.
              // The visible `<Button>` opens it programmatically, so it carries the
              // affordance — but a keyboard or screen-reader user who tabs onto the
              // input itself reached a file field with no announced purpose, which is
              // the same defect class as the pointer-only rename affordance and the
              // unnamed dialog that previously shipped through here.
              aria-label="Upload a video to analyse"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <div className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
              <Play className="size-5 translate-x-[1px]" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground-strong">
              {fileName || 'Drop video or click to browse'}
            </p>
            <p className={`text-xs ${textMuted}`}>MP4, MOV, AVI • 500 MB max</p>
            <Button
              size="sm"
              onClick={open}
              className="mt-4 h-9 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Choose video
            </Button>
            {fileError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {fileError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── testimonials ─────────────────────────────────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${surface}`}>
        <div className="mx-auto max-w-[1120px]">
          <h2 className={`text-center ${sectionTitle}`}>What coaches say</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
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
              <div key={c.q} className={`p-6 ${card}`}>
                <p className="text-title leading-[1.6] text-foreground-strong">
                  &ldquo;{c.q}&rdquo;
                </p>
                <p className={`mt-3 text-meta ${textMuted}`}>— {c.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className={`px-6 py-14 lg:px-8 ${band}`}>
        <div className="mx-auto max-w-[760px]">
          <h2 className={`text-center ${sectionTitle}`}>Frequently Asked Questions</h2>
          <div
            className={`mt-8 divide-y border-t ${hairline} divide-foreground/9 dark:divide-white/8`}
          >
            {FAQS.map((f, i) => (
              <div key={f.q} className="py-5">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-${i}`}
                  className={`flex w-full items-center justify-between gap-4 rounded-[6px] text-left ${focusRing}`}
                >
                  <span className="text-title font-medium text-foreground-strong">{f.q}</span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${openFaq === i ? 'rotate-180' : ''}`}
                  />
                </button>
                {openFaq === i && (
                  <p id={`faq-${i}`} className={`mt-3 text-sm leading-[1.6] ${textMuted}`}>
                    {f.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── final CTA — split ────────────────────────────────────────────── */}
      <section className={`px-6 pb-14 lg:px-8 ${surface}`}>
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className="rounded-[8px] border border-primary/20 bg-primary/[0.06] p-8 dark:bg-primary/[0.09]">
            <h2 className="text-[24px] font-bold leading-tight tracking-[-0.01em] text-balance text-foreground-strong sm:text-[28px]">
              Ready to make your training more efficient?
            </h2>
            <Button
              onClick={open}
              className="mt-5 h-10 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Start for free
            </Button>
          </div>
          <div
            className={`flex flex-col items-start justify-center rounded-[8px] border p-8 ${hairline} ${surface}`}
          >
            <p className="text-[18px] font-semibold text-foreground-strong">
              Not ready to buy yet?
            </p>
            <p className={`mt-1 text-sm ${textMuted}`}>Book a call with our coaching specialist</p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/contact" />}
              className="mt-4 h-10 rounded-[6px] border-input bg-transparent px-5 text-sm font-medium text-link hover:bg-muted"
            >
              Book a call
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer — Notion: 4 link columns + quote + bottom row ─────────── */}
      <footer className={`border-t px-6 py-12 lg:px-8 ${hairline} bg-muted dark:bg-background`}>
        <div className="mx-auto max-w-[1120px]">
          <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
            <div>
              <Link
                href="/"
                className={`inline-flex items-center gap-2 rounded-[6px] ${focusRing}`}
              >
                <span className="grid size-6 place-items-center rounded-[6px] bg-primary text-label font-bold text-primary-foreground">
                  C
                </span>
                <span className="text-sm font-semibold text-foreground-strong">CoachXYZ</span>
              </Link>
              <blockquote className="mt-5 max-w-[280px] border-l-2 border-input pl-4 text-sm italic leading-[1.6] text-muted-foreground">
                &ldquo;CoachXYZ cut our review time in half. Players get precise fixes same
                day.&rdquo;
              </blockquote>
              <cite className="mt-2 block pl-4 text-meta not-italic text-muted-foreground/70">
                — David R., Performance Coach
              </cite>
            </div>

            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-meta font-medium text-muted-foreground">{col.title}</p>
                <div className="mt-3 flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <Link key={l.label} href={l.href} className={footerLink}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* newsletter */}
          <div
            className={`mt-10 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between ${hairline}`}
          >
            <p className="text-meta text-muted-foreground">
              Get product updates — no spam, unsubscribe anytime.
            </p>
            <form onSubmit={subscribe} className="flex gap-2">
              <label htmlFor="footer-subscribe" className="sr-only">
                Email address
              </label>
              <input
                id="footer-subscribe"
                value={subscribeEmail}
                onChange={(e) => setSubscribeEmail(e.target.value)}
                type="email"
                required
                placeholder="you@academy.com"
                className={`h-9 w-[220px] rounded-[6px] border bg-background px-3 text-sm text-foreground-strong transition-colors duration-150 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${hairline}`}
              />
              <Button
                type="submit"
                size="sm"
                className="h-9 rounded-[6px] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Subscribe
              </Button>
            </form>
          </div>

          {/* bottom row */}
          <div
            className={`mt-6 flex flex-col items-start justify-between gap-4 border-t pt-6 sm:flex-row sm:items-center ${hairline}`}
          >
            <div className="flex flex-wrap items-center gap-4 text-meta text-muted-foreground">
              <span>© {new Date().getFullYear()} CoachXYZ, Inc.</span>
              <button
                type="button"
                className={`rounded-[6px] transition-colors duration-[120ms] hover:text-primary hover:underline ${focusRing}`}
              >
                Cookie settings
              </button>
            </div>
            <button
              type="button"
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-meta font-medium text-foreground transition-colors duration-150 hover:bg-muted dark:bg-transparent ${hairline} ${focusRing}`}
            >
              <Globe className="size-3.5" aria-hidden />
              English
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}
