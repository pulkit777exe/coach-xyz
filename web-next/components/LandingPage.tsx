'use client'

import { useRef, useState } from 'react'

interface LandingPageProps {
  onFileSelected: (file: File) => void
}

const workflow = [
  {
    step: '01',
    title: 'Upload one training clip',
    text: 'Drag in basketball, football, or cricket footage. CoachXYZ auto-validates video quality before processing.',
  },
  {
    step: '02',
    title: 'Pick the athlete to review',
    text: 'When multiple players are in frame, we detect each athlete and let you choose the one you want analyzed.',
  },
  {
    step: '03',
    title: 'Get frame-level coaching notes',
    text: 'Every event gets a form score, a timestamp, and practical correction tips you can apply in the next session.',
  },
  {
    step: '04',
    title: 'Share the annotated output',
    text: 'Export an overlay video and concise session summary for athletes, assistants, or remote coaching reviews.',
  },
]

const systemCards = [
  {
    title: 'Adaptive Event Timeline',
    body: 'From jump shots to headers and cricket drives, event labeling switches by sport without manual setup.',
  },
  {
    title: 'Auto Session Summary',
    body: 'Highlights strengths, recurring issues, and one priority drill so each athlete knows what to fix next.',
  },
  {
    title: 'Practical Coaching Language',
    body: 'Feedback is written for real training blocks, not generic analytics dashboards.',
  },
]

const customizationCards = [
  {
    title: 'Coach Profile',
    copy: 'Apply your team logo, coaching style, and terminology across every generated report.',
  },
  {
    title: 'Drill Intent',
    copy: 'Set the intent of the session like mechanics, speed, contact, or consistency before you analyze.',
  },
  {
    title: 'Performance Filters',
    copy: 'Focus on made attempts, misses, body posture quality, or release mechanics in one click.',
  },
]

const deliveryCards = [
  {
    heading: 'Athlete View',
    text: 'A focused, mobile-friendly summary for athletes with only the actions they need before the next practice.',
  },
  {
    heading: 'Staff View',
    text: 'Expanded breakdown for assistant coaches with trend context, event history, and printable drill notes.',
  },
]

const integrations = ['Google Drive', 'Notion', 'WhatsApp', 'Slack', 'Email', 'Hudl', 'Telegram', 'CSV export']

const faqs = [
  {
    q: 'How long does one analysis take?',
    a: 'Most clips finish in under a minute. Long videos or dense multi-player footage may take longer.',
  },
  {
    q: 'Which sports can I analyze right now?',
    a: 'Basketball, football, and cricket are supported today with sport-specific event labels and scoring logic.',
  },
  {
    q: 'Can I use this for team sessions?',
    a: 'Yes. Upload one clip, choose a detected athlete, and repeat quickly for each player in the same training set.',
  },
  {
    q: 'Do I get both numbers and coaching cues?',
    a: 'Yes. You get form scores plus direct feedback so athletes know exactly what to change.',
  },
]

export default function LandingPage({ onFileSelected }: LandingPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')

  const selectFile = (file?: File) => {
    if (!file) return
    setFileName(file.name)
    onFileSelected(file)
  }

  const openPicker = () => {
    fileInputRef.current?.click()
  }

  return (
    <main className="relative overflow-hidden pb-20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,79,214,0.12),transparent_62%)]" />
      <div className="pointer-events-none absolute -top-28 right-[-12rem] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(38,109,244,0.2),transparent_65%)]" />

      <header className="sticky top-0 z-20 border-b border-black/8 bg-[#f7f6f3]/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <a href="#" className="flex items-center gap-2 text-[0.95rem] font-semibold">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/20 bg-white">C</span>
            <span>coach.xyz</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm md:flex">
            <a className="landing-link" href="#workflow">Workflow</a>
            <a className="landing-link" href="#design">Reports</a>
            <a className="landing-link" href="#faq">FAQ</a>
          </nav>
          <a
            href="#analyze"
            className="rounded-full border border-black/15 bg-black px-4 py-2 text-xs font-semibold tracking-wide text-white transition-colors hover:bg-black/80"
          >
            Analyze Now
          </a>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 md:pt-24">
        <svg
          aria-hidden
          className="floating-scribble absolute -left-6 top-24 hidden h-16 w-16 text-black/70 lg:block"
          viewBox="0 0 72 72"
          fill="none"
        >
          <path d="M10 28c8-10 14-17 26-17 13 0 27 10 27 24 0 14-11 25-26 25S12 49 12 38" stroke="currentColor" strokeWidth="2.2" />
          <path d="m45 15 8-7M52 30l10-3M8 40l-6 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <svg
          aria-hidden
          className="floating-scribble-2 absolute -right-2 top-40 hidden h-12 w-12 text-[#ff4fd6] lg:block"
          viewBox="0 0 64 64"
          fill="none"
        >
          <path d="M12 18c9-8 30-10 39 1 11 12 2 34-13 36-17 2-31-11-28-25 1-4 2-7 6-12" stroke="currentColor" strokeWidth="2.4" />
        </svg>

        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/75">
            Sports AI Coaching Platform
          </p>
          <h1 className="font-display text-balance text-[clamp(2.2rem,6vw,4.7rem)] leading-[1.02]">
            The simplest way to
            <span className="highlight-marker"> coach game footage</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-black/65">
            CoachXYZ turns raw practice video into timestamped form scores, correction cues, and share-ready reports for athletes and staff.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#analyze" className="button-accent rounded-full px-6 py-3 text-sm font-semibold transition-colors">Start free analysis</a>
            <a href="#workflow" className="button-ink rounded-full px-6 py-3 text-sm font-semibold transition-colors">See workflow</a>
          </div>
        </div>

        <div id="analyze" className="paper-card mx-auto mt-12 max-w-4xl rounded-[30px] p-5 md:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Analyze now</h2>
              <p className="text-sm text-black/60">Upload a clip and receive athlete-specific feedback in under 60 seconds.</p>
            </div>
            <span className="rounded-full border border-black/15 bg-[#fff8fe] px-3 py-1 text-xs font-semibold text-[#ad178a]">No setup needed</span>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Upload sports video"
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openPicker()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              selectFile(event.dataTransfer.files[0])
            }}
            className={`rounded-2xl border border-dashed p-8 text-center transition-colors md:p-10 ${
              isDragging ? 'stroke-accent bg-[#fff5fd]' : 'border-black/20 bg-[#fbfbfa] hover:border-black/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <p className="font-display text-2xl">Drop your training video</p>
            <p className="mt-2 text-sm text-black/60">
              {fileName ? `Selected: ${fileName}` : 'MP4, MOV, AVI, MKV up to 500MB'}
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openPicker()
              }}
              className="button-accent mt-5 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors"
            >
              Choose video
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="paper-card-soft rounded-xl p-3 text-sm">
              <p className="text-black/50">Supported sports</p>
              <p className="mt-1 font-semibold">Basketball, Football, Cricket</p>
            </div>
            <div className="paper-card-soft rounded-xl p-3 text-sm">
              <p className="text-black/50">Output</p>
              <p className="mt-1 font-semibold">Scores + tips + overlay video</p>
            </div>
            <div className="paper-card-soft rounded-xl p-3 text-sm">
              <p className="text-black/50">Processing</p>
              <p className="mt-1 font-semibold">Async and auto-resumable</p>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="mb-10 max-w-3xl">
          <h2 className="font-display text-[clamp(1.9rem,4vw,3rem)] leading-tight">
            A coaching engine that adapts
            <span className="pink-accent"> to your training context</span>
          </h2>
          <p className="mt-4 text-black/60">
            Built for practical sessions, not spreadsheet theater. CoachXYZ keeps the workflow short and the feedback actionable.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <article className="paper-card rounded-3xl p-6 md:p-8">
            <h3 className="font-display text-2xl">From upload to coaching plan</h3>
            <p className="mt-2 text-sm text-black/55">One timeline maps every event so coaches can review technique quickly.</p>

            <div className="mt-7 space-y-4">
              {workflow.map((item) => (
                <div key={item.step} className="flex gap-4 rounded-2xl border border-black/10 bg-[#fcfcfb] p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/20 text-xs font-semibold">
                    {item.step}
                  </div>
                  <div>
                    <h4 className="font-semibold">{item.title}</h4>
                    <p className="mt-1 text-sm text-black/60">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <div className="grid gap-5">
            {systemCards.map((card, index) => (
              <article
                key={card.title}
                className={`paper-card rounded-3xl p-6 ${
                  index === 1 ? 'border-[#ff4fd680] bg-[#fff6fd]' : ''
                }`}
              >
                <h3 className="font-display text-xl">{card.title}</h3>
                <p className="mt-2 text-sm text-black/60">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="design" className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <h2 className="font-display text-[clamp(1.8rem,3.7vw,2.8rem)]">Shape reports around your coaching style</h2>
            <p className="mt-3 text-black/60">
              Keep your tone, your drill language, and your priorities consistent across all generated athlete feedback.
            </p>
          </div>
          <p className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-black/70">
            Configuration without complexity
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {customizationCards.map((card) => (
            <article key={card.title} className="paper-card rounded-2xl p-5">
              <h3 className="font-display text-xl">{card.title}</h3>
              <p className="mt-2 text-sm text-black/60">{card.copy}</p>
            </article>
          ))}
        </div>

        <article className="paper-card mt-5 grid gap-5 rounded-3xl p-6 md:grid-cols-[1.1fr_1fr] md:p-8">
          <div>
            <h3 className="font-display text-2xl">Clear scorecards for every athlete</h3>
            <p className="mt-3 text-sm text-black/60">
              Form score, success rate, and issue clusters are shown in one compact panel so athletes know exactly what to focus on.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-black/70">
              <li>Timestamp-linked event list</li>
              <li>Per-event form breakdown</li>
              <li>Priority drill recommendation</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-black/10 bg-[#fbfbfb] p-4">
            <div className="flex items-center justify-between border-b border-black/10 pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/55">Session Snapshot</p>
              <span className="rounded-full bg-black px-2.5 py-1 text-[0.65rem] font-semibold text-white">Live</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-black/10 bg-white p-3">
                <p className="text-black/50">Form score</p>
                <p className="mt-1 text-2xl font-bold">87</p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white p-3">
                <p className="text-black/50">Success rate</p>
                <p className="mt-1 text-2xl font-bold">74%</p>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-[#ff4fd666] bg-[#fff4fc] p-3 text-sm">
              <p className="font-semibold text-[#9d146f]">Focus next</p>
              <p className="mt-1 text-black/70">Lower base before release and hold follow-through for one full beat.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="grid gap-5 md:grid-cols-2">
          {deliveryCards.map((card, idx) => (
            <article key={card.heading} className={`paper-card rounded-3xl p-6 ${idx === 1 ? 'bg-[#f8faff]' : ''}`}>
              <h3 className="font-display text-2xl">{card.heading}</h3>
              <p className="mt-2 text-sm text-black/60">{card.text}</p>
              <div className="mt-5 rounded-2xl border border-black/12 bg-white p-4 text-sm text-black/65">
                <p className="font-semibold">{idx === 0 ? 'Key blocks' : 'Extended blocks'}</p>
                <p className="mt-1">
                  {idx === 0 ? 'Top 3 fixes, quick clip links, progress trend.' : 'Event timeline, issue frequency, drill agenda, export links.'}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="paper-card rounded-3xl p-6 md:p-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-[clamp(1.7rem,3.6vw,2.5rem)]">Connect your existing coaching stack</h2>
              <p className="mt-2 text-sm text-black/60">Plug output into your current workflow without rebuilding your process.</p>
            </div>
            <span className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-black/65">
              Built for teams and solo coaches
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {integrations.map((item) => (
              <span
                key={item}
                className="rounded-full border border-black/15 bg-[#fafaf8] px-3 py-1.5 text-sm font-medium text-black/75"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="grid gap-5 md:grid-cols-3">
          <article className="paper-card rounded-3xl p-6 md:col-span-2">
            <p className="font-display text-2xl leading-snug">
              "CoachXYZ cut our review time in half. Players now receive precise fixes the same day instead of waiting for manual notes."
            </p>
            <p className="mt-4 text-sm text-black/60">Performance Coach, Semi-pro Academy</p>
          </article>
          <article className="paper-card rounded-3xl p-6">
            <p className="font-display text-2xl leading-snug">
              "The timestamped corrections make remote coaching way more effective."
            </p>
            <p className="mt-4 text-sm text-black/60">Youth Development Program Lead</p>
          </article>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="paper-card relative overflow-hidden rounded-3xl p-6 md:p-8">
          <svg
            aria-hidden
            className="floating-scribble absolute -right-6 -top-5 hidden h-14 w-14 text-[#ff4fd6] md:block"
            viewBox="0 0 58 58"
            fill="none"
          >
            <path d="M10 29c0-9 9-19 21-19s20 8 20 19-8 19-20 19S10 39 10 29Z" stroke="currentColor" strokeWidth="2.2" />
            <path d="m25 24 8 6-8 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)]">Questions coaches ask first</h2>
          <div className="mt-6 space-y-3">
            {faqs.map((item) => (
              <details key={item.q} className="rounded-2xl border border-black/12 bg-white p-4 open:bg-[#fbfbff]">
                <summary className="cursor-pointer list-none pr-8 text-sm font-semibold text-black/85">{item.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-black/65">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pt-10 md:px-8">
        <div className="relative rounded-[32px] border border-black/15 bg-[#101015] px-6 py-12 text-center text-white md:px-10">
          <svg
            aria-hidden
            className="absolute left-5 top-5 h-9 w-9 text-[#ff4fd6]"
            viewBox="0 0 44 44"
            fill="none"
          >
            <path d="M10 22c8-9 17-13 24-9 8 4 8 16 3 23-4 6-13 9-21 6-9-4-11-14-6-20Z" stroke="currentColor" strokeWidth="2.2" />
          </svg>
          <h2 className="font-display text-[clamp(1.7rem,4vw,2.8rem)] text-balance">Build stronger athletes with faster review loops</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/75 md:text-base">
            Upload the next training clip now and generate a complete coaching report before the session ends.
          </p>
          <a href="#analyze" className="mt-6 inline-flex rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/85">
            Start analyzing for free
          </a>
        </div>
      </section>

      <footer className="mx-auto mt-16 max-w-6xl border-t border-black/10 px-5 pt-10 md:px-8">
        <div className="flex flex-col gap-8 pb-10 md:flex-row md:justify-between">
          <div>
            <p className="font-display text-2xl">coach.xyz</p>
            <p className="mt-2 max-w-xs text-sm text-black/60">
              AI-powered sports video analysis for coaches who want faster feedback and measurable athlete progress.
            </p>
          </div>
          <div className="grid gap-6 text-sm text-black/65 sm:grid-cols-2">
            <div className="space-y-2">
              <a className="landing-link block" href="#workflow">Workflow</a>
              <a className="landing-link block" href="#design">Reports</a>
              <a className="landing-link block" href="#faq">FAQ</a>
            </div>
            <div className="space-y-2">
              <p>Basketball analysis</p>
              <p>Football analysis</p>
              <p>Cricket analysis</p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
