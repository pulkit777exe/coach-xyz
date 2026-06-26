'use client'

import { useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, useGSAP)
}

interface LandingPageProps {
  onFileSelected: (file: File) => void
}

const workflow = [
  {
    step: '01',
    title: 'Upload one training clip',
    text: 'Drag in basketball, football, or cricket footage. CoachXYZ auto-validates video quality.',
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
  const containerRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')

  useGSAP(() => {
    // Basic hero entry
    gsap.from('.gsap-hero', {
      y: 40,
      opacity: 0,
      duration: 1,
      stagger: 0.1,
      ease: 'power3.out',
    })

    // Sub-elements to fade in slightly later
    gsap.from('.gsap-fade', {
      opacity: 0,
      duration: 1,
      delay: 0.4,
      stagger: 0.1,
      ease: 'power2.out',
    })

    // Scroll trigger sections for overall section fade
    const sections = gsap.utils.toArray('.gsap-section')
    sections.forEach((section: any) => {
      gsap.from(section, {
        scrollTrigger: {
          trigger: section,
          start: 'top 85%',
        },
        opacity: 0,
        y: 40,
        duration: 0.8,
        ease: 'power2.out',
      })
    })

    // Inner scroll cards for staggered pop
    const cards = gsap.utils.toArray('.gsap-card')
    cards.forEach((card: any, index) => {
      gsap.from(card, {
        scrollTrigger: {
          trigger: card,
          start: 'top 90%',
        },
        y: 30,
        opacity: 0,
        duration: 0.6,
        delay: (index % 3) * 0.1,
        ease: 'power2.out',
      })
    })

    // Floating animation
    gsap.to('.gsap-float', {
      y: -10,
      rotation: 2,
      duration: 3,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    })

  }, { scope: containerRef })

  const selectFile = (file?: File) => {
    if (!file) return
    setFileName(file.name)
    onFileSelected(file)
  }

  const openPicker = () => {
    fileInputRef.current?.click()
  }

  return (
    <main ref={containerRef} className="relative overflow-hidden pb-20 text-zinc-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.15),transparent_60%)]" />
      <div className="pointer-events-none absolute -top-40 -right-48 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.15),transparent_65%)]" />

      <header className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <a href="#" className="flex items-center gap-2 text-[0.95rem] font-semibold text-white">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-zinc-800 shadow-[0_0_12px_rgba(20,184,166,0.3)]">C</span>
            <span>coach.xyz</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm md:flex text-zinc-400">
            <a className="transition-colors hover:text-white" href="#workflow">Workflow</a>
            <a className="transition-colors hover:text-white" href="#design">Reports</a>
            <a className="transition-colors hover:text-white" href="#faq">FAQ</a>
          </nav>
          <a
            href="#analyze"
            className="rounded-full border border-white/10 bg-zinc-900 px-5 py-2 text-xs font-semibold tracking-wide text-white transition-all hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(255,255,255,0.1)]"
          >
            Analyze Now
          </a>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 md:pt-24">
        {/* Decorative elements */}
        <svg
          aria-hidden
          className="gsap-float absolute -left-6 top-24 hidden h-16 w-16 text-teal-500/50 lg:block"
          viewBox="0 0 72 72"
          fill="none"
        >
          <path d="M10 28c8-10 14-17 26-17 13 0 27 10 27 24 0 14-11 25-26 25S12 49 12 38" stroke="currentColor" strokeWidth="2.2" />
          <path d="m45 15 8-7M52 30l10-3M8 40l-6 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <svg
          aria-hidden
          className="gsap-float absolute -right-2 top-40 hidden h-12 w-12 text-purple-500/60 lg:block"
          style={{ animationDelay: '1s' }}
          viewBox="0 0 64 64"
          fill="none"
        >
          <path d="M12 18c9-8 30-10 39 1 11 12 2 34-13 36-17 2-31-11-28-25 1-4 2-7 6-12" stroke="currentColor" strokeWidth="2.4" />
        </svg>

        <div className="mx-auto max-w-4xl text-center">
          <p className="gsap-hero mb-4 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">
            Sports AI Coaching Platform
          </p>
          <h1 className="gsap-hero font-display text-balance text-[clamp(2.5rem,7vw,5.5rem)] leading-[1.05] text-white font-bold">
            The simplest way to
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400"> coach game footage</span>
          </h1>
          <p className="gsap-hero mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            CoachXYZ turns raw practice video into timestamped form scores, correction cues, and share-ready reports for athletes and staff.
          </p>
          <div className="gsap-hero mt-10 flex flex-wrap items-center justify-center gap-4">
            <a href="#analyze" className="button-accent rounded-full px-8 py-3.5 text-sm font-semibold transition-all hover:scale-105 active:scale-95">
              Start free analysis
            </a>
            <a href="#workflow" className="button-ink rounded-full px-8 py-3.5 text-sm font-semibold transition-colors hover:text-white">
              See workflow
            </a>
          </div>
        </div>

        <div id="analyze" className="gsap-hero paper-card mx-auto mt-16 max-w-4xl rounded-[30px] p-6 md:p-10 shadow-2xl shadow-cyan-900/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/5 blur-3xl rounded-full pointer-events-none" />
          
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 relative z-10">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Analyze now</h2>
              <p className="text-sm text-zinc-400">Upload a clip and receive athlete-specific feedback in under 60 seconds.</p>
            </div>
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-1.5 text-xs font-semibold text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
              No setup needed
            </span>
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
            className={`relative z-10 rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 md:p-14 ${
              isDragging ? 'border-teal-400 bg-teal-500/5 scale-[1.02]' : 'border-zinc-700 bg-zinc-900/50 hover:border-zinc-500'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <div className="mx-auto flex h-16 w-16 mb-4 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700">
              <svg className="w-8 h-8 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="font-display text-2xl text-white">Drop your training video</p>
            <p className="mt-2 text-sm text-zinc-400">
              {fileName ? <span className="text-teal-300">Selected: {fileName}</span> : 'MP4, MOV, AVI, up to 500MB'}
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openPicker()
              }}
              className="button-accent mt-6 rounded-full px-8 py-3 text-sm font-semibold transition-transform hover:scale-105"
            >
              Choose video
            </button>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 relative z-10">
            <div className="paper-card-soft rounded-xl p-4 text-sm border-white/5 transition-transform hover:-translate-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Supported sports</p>
              <p className="mt-1 font-medium text-white">Basketball, Football, Cricket</p>
            </div>
            <div className="paper-card-soft rounded-xl p-4 text-sm border-white/5 transition-transform hover:-translate-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Output</p>
              <p className="mt-1 font-medium text-white">Scores + tips + overlay video</p>
            </div>
            <div className="paper-card-soft rounded-xl p-4 text-sm border-white/5 transition-transform hover:-translate-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Processing</p>
              <p className="mt-1 font-medium text-white">Async and auto-resumable</p>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="gsap-section mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="mb-12 max-w-3xl">
          <h2 className="font-display text-[clamp(2rem,4vw,3.5rem)] leading-tight text-white font-bold">
            A coaching engine that adapts
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400"> to your training context</span>
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            Built for practical sessions, not spreadsheet theater. CoachXYZ keeps the workflow short and the feedback actionable.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <article className="gsap-card paper-card rounded-3xl p-8 md:p-10 border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
            <h3 className="font-display text-2xl font-bold text-white">From upload to coaching plan</h3>
            <p className="mt-2 text-sm text-zinc-400">One timeline maps every event so coaches can review technique quickly.</p>

            <div className="mt-8 space-y-4">
              {workflow.map((item, i) => (
                <div key={item.step} className="flex gap-5 rounded-2xl border border-white/5 bg-zinc-900/40 p-5 transition-colors hover:bg-zinc-800/60">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm font-bold ${i === 0 ? 'bg-teal-500/20 text-teal-300 border-teal-500/30' : 'bg-zinc-800 text-white'}`}>
                    {item.step}
                  </div>
                  <div>
                    <h4 className="font-semibold text-white">{item.title}</h4>
                    <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <div className="grid gap-6">
            {systemCards.map((card, index) => (
              <article
                key={card.title}
                className={`gsap-card paper-card rounded-3xl p-8 border-white/10 ${
                  index === 1 ? 'border-purple-500/30 bg-purple-900/10 shadow-[inset_0_0_20px_rgba(168,85,247,0.1)]' : ''
                }`}
              >
                <div className="mb-4">
                  {index === 0 && <span className="text-2xl">⏱️</span>}
                  {index === 1 && <span className="text-2xl">✨</span>}
                  {index === 2 && <span className="text-2xl">📋</span>}
                </div>
                <h3 className="font-display text-xl font-bold text-white">{card.title}</h3>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="design" className="gsap-section mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24 border-t border-white/5 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
        
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-[clamp(2rem,3.7vw,3.2rem)] font-bold text-white leading-tight">Shape reports around your coaching style</h2>
            <p className="mt-4 text-lg text-zinc-400">
              Keep your tone, your drill language, and your priorities consistent across all generated athlete feedback.
            </p>
          </div>
          <p className="rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-teal-300">
            Configuration without complexity
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {customizationCards.map((card) => (
            <article key={card.title} className="gsap-card paper-card rounded-3xl p-6 border-white/5 transition-all hover:border-white/20 hover:bg-zinc-800/50">
              <h3 className="font-display text-lg font-bold text-white">{card.title}</h3>
              <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{card.copy}</p>
            </article>
          ))}
        </div>

        <article className="gsap-card paper-card mt-6 grid gap-8 rounded-[2rem] p-8 md:grid-cols-[1.2fr_1fr] md:p-10 border-white/10 shadow-2xl shadow-black/50 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 blur-3xl rounded-full pointer-events-none" />
          
          <div className="relative z-10">
            <span className="inline-block px-3 py-1 bg-white/10 rounded-md text-xs font-medium text-white mb-4 border border-white/10">Output Preview</span>
            <h3 className="font-display text-3xl font-bold text-white">Clear scorecards for every athlete</h3>
            <p className="mt-4 text-zinc-400 leading-relaxed">
              Form score, success rate, and issue clusters are shown in one compact panel so athletes know exactly what to focus on before their next rep.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-300">
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-teal-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                Timestamp-linked event list
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-teal-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                Per-event form breakdown
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-5 h-5 text-teal-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                Priority drill recommendation
              </li>
            </ul>
          </div>

          <div className="relative z-10 rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-inner">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Session Snapshot</p>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[0.65rem] font-bold text-zinc-400 uppercase tracking-wider">Live</span>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl border border-white/5 bg-zinc-900 p-4">
                <p className="text-zinc-500 font-medium">Form score</p>
                <p className="mt-2 text-3xl font-bold text-white">87</p>
                <div className="mt-2 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 w-[87%] rounded-full shadow-[0_0_10px_rgba(20,184,166,0.5)]"></div>
                </div>
              </div>
              <div className="rounded-xl border border-white/5 bg-zinc-900 p-4">
                <p className="text-zinc-500 font-medium">Success rate</p>
                <p className="mt-2 text-3xl font-bold text-white">74%</p>
                <div className="mt-2 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 w-[74%] rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/10 p-4 text-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
              <p className="font-semibold text-purple-300">Focus next</p>
              <p className="mt-2 text-zinc-300 leading-relaxed">Lower base before release and hold follow-through for one full beat.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="gsap-section mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="grid gap-6 md:grid-cols-2">
          {deliveryCards.map((card, idx) => (
            <article key={card.heading} className={`gsap-card paper-card rounded-3xl p-8 border-white/5 ${idx === 1 ? 'bg-gradient-to-br from-zinc-900 to-zinc-950 border-white/10' : ''}`}>
              <h3 className="font-display text-2xl font-bold text-white">{card.heading}</h3>
              <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{card.text}</p>
              <div className="mt-6 rounded-2xl border border-white/5 bg-zinc-900/50 p-5 text-sm text-zinc-300">
                <p className="font-semibold text-white flex items-center gap-2">
                  <span className="text-teal-400">❖</span> {idx === 0 ? 'Key blocks' : 'Extended blocks'}
                </p>
                <p className="mt-2">
                  {idx === 0 ? 'Top 3 fixes, quick clip links, progress trend.' : 'Event timeline, issue frequency, drill agenda, export links.'}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="gsap-section mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="gsap-card paper-card rounded-[2rem] p-8 md:p-10 border-white/5 bg-gradient-to-r from-zinc-900/80 to-zinc-900/40">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="font-display text-[clamp(1.8rem,3.6vw,2.5rem)] font-bold text-white">Connect your existing coaching stack</h2>
              <p className="mt-2 text-zinc-400">Plug output into your current workflow without rebuilding your process.</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-300">
              For teams & solos
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {integrations.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="gsap-section mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="grid gap-6 md:grid-cols-3">
          <article className="gsap-card paper-card rounded-3xl p-8 md:col-span-2 border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-2xl rounded-full" />
            <svg className="w-8 h-8 text-cyan-500/50 mb-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>
            <p className="font-display text-2xl leading-snug text-white font-medium">
              "CoachXYZ cut our review time in half. Players now receive precise fixes the same day instead of waiting for manual notes."
            </p>
            <div className="mt-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10"></div>
              <div>
                <p className="text-sm text-white font-semibold">David R.</p>
                <p className="text-xs text-zinc-400">Performance Coach</p>
              </div>
            </div>
          </article>
          <article className="gsap-card paper-card rounded-3xl p-8 border-white/5">
            <svg className="w-6 h-6 text-purple-500/50 mb-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>
            <p className="font-display text-xl leading-snug text-white">
              "The timestamped corrections make remote coaching way more effective."
            </p>
            <div className="mt-6 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10"></div>
              <div>
                <p className="text-sm text-white font-semibold">Sarah T.</p>
                <p className="text-xs text-zinc-400">Youth Lead</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="faq" className="gsap-section mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="gsap-card paper-card relative overflow-hidden rounded-[2.5rem] p-8 md:p-12 border-white/5">
          <svg
            aria-hidden
            className="gsap-float absolute -right-6 -top-5 hidden h-20 w-20 text-teal-500/20 md:block"
            viewBox="0 0 58 58"
            fill="none"
          >
            <path d="M10 29c0-9 9-19 21-19s20 8 20 19-8 19-20 19S10 39 10 29Z" stroke="currentColor" strokeWidth="2.2" />
            <path d="m25 24 8 6-8 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="font-display text-[clamp(2rem,4vw,3rem)] font-bold text-white mb-8">Questions coaches ask first</h2>
          <div className="space-y-4">
            {faqs.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-white/5 bg-zinc-900/40 p-5 transition-all open:bg-zinc-800/60 open:border-white/10">
                <summary className="cursor-pointer list-none pr-8 text-sm font-semibold text-white/90 group-open:text-teal-400 transition-colors flex justify-between items-center">
                  {item.q}
                  <svg className="w-5 h-5 text-zinc-500 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-zinc-400">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="gsap-section mx-auto max-w-5xl px-5 pt-12 pb-20 md:px-8">
        <div className="gsap-card relative overflow-hidden rounded-[3rem] border border-cyan-500/20 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-16 text-center shadow-[0_0_50px_rgba(6,182,212,0.1)] md:px-12 md:py-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.1),transparent_70%)] pointer-events-none" />
          <svg
            aria-hidden
            className="gsap-float mx-auto mb-6 h-12 w-12 text-teal-400"
            viewBox="0 0 44 44"
            fill="none"
          >
            <path d="M10 22c8-9 17-13 24-9 8 4 8 16 3 23-4 6-13 9-21 6-9-4-11-14-6-20Z" stroke="currentColor" strokeWidth="2.2" />
          </svg>
          <h2 className="relative z-10 font-display text-[clamp(2rem,4vw,3.5rem)] font-bold text-white text-balance tracking-tight">
            Build stronger athletes with faster review loops
          </h2>
          <p className="relative z-10 mx-auto mt-5 max-w-2xl text-base text-zinc-400 md:text-lg">
            Upload the next training clip now and generate a complete coaching report before the session ends.
          </p>
          <a href="#analyze" className="relative z-10 mt-8 inline-flex rounded-full bg-white px-8 py-4 text-sm font-bold text-black transition-transform hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)]">
            Start analyzing for free
          </a>
        </div>
      </section>

      <footer className="mx-auto mt-16 max-w-6xl border-t border-white/10 px-5 pt-12 md:px-8">
        <div className="flex flex-col gap-10 pb-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 text-[1rem] font-bold text-white mb-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-zinc-800">C</span>
              <span>coach.xyz</span>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed">
              AI-powered sports video analysis for coaches who want faster feedback and measurable athlete progress.
            </p>
          </div>
          <div className="grid gap-8 text-sm text-zinc-400 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-white font-semibold mb-2">Platform</p>
              <a className="block transition-colors hover:text-white" href="#workflow">Workflow</a>
              <a className="block transition-colors hover:text-white" href="#design">Reports</a>
              <a className="block transition-colors hover:text-white" href="#faq">FAQ</a>
            </div>
            <div className="space-y-3">
              <p className="text-white font-semibold mb-2">Capabilities</p>
              <p>Basketball analysis</p>
              <p>Football analysis</p>
              <p>Cricket analysis</p>
            </div>
          </div>
        </div>
        <div className="border-t border-white/5 py-6 text-center text-xs text-zinc-600 flex justify-between">
          <p>© {new Date().getFullYear()} CoachXYZ. All rights reserved.</p>
          <p className="text-teal-500/70 blur-[1px]">Build with Gemini AI</p>
        </div>
      </footer>
    </main>
  )
}
