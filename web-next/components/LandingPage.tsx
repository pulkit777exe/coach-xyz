'use client'

import { useRef, useState, useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, useGSAP)
}

interface LandingPageProps {
  onFileSelected: (file: File) => void
}

const stats = [
  { value: '60s', label: 'Analysis time' },
  { value: '3', label: 'Sports supported' },
  { value: '∞', label: 'Clips per session' },
]

const workflow = [
  {
    step: '01',
    title: 'Upload',
    description: 'Drag in basketball, football, or cricket footage. We validate format and quality automatically.',
  },
  {
    step: '02',
    title: 'Detect',
    description: 'MediaPipe pose estimation identifies every athlete in frame with bounding boxes and confidence scores.',
  },
  {
    step: '03',
    title: 'Analyze',
    description: 'Gemini evaluates form, mechanics, and technique across keyframes. Each event gets a score and correction.',
  },
  {
    step: '04',
    title: 'Deliver',
    description: 'Annotated video with pose overlays, HUD stats, and coaching feedback — ready to share.',
  },
]

const features = [
  {
    eyebrow: 'Event Timeline',
    title: 'Every shot, timestamped',
    description: 'From jump shots to cricket drives, each event is labeled with sport-specific scoring and practical correction tips.',
  },
  {
    eyebrow: 'Session Summary',
    title: 'Strengths and fixes',
    description: 'One panel shows what\'s working, what needs adjustment, and the priority drill for the next practice.',
  },
  {
    eyebrow: 'Annotated Output',
    title: 'Video with overlays',
    description: 'Pose landmarks, form scores, and coaching cues rendered directly onto the footage frame by frame.',
  },
]

const sports = [
  { name: 'Basketball', events: 'Jump shots, layups, free throws, 3-pointers' },
  { name: 'Football', events: 'Strikes, headers, volleys, penalties' },
  { name: 'Cricket', events: 'Drives, pulls, sweeps, cuts, hooks' },
]

const faqs = [
  {
    q: 'How long does one analysis take?',
    a: 'Most clips finish in under 60 seconds. Longer videos or dense multi-player footage may take a bit more time.',
  },
  {
    q: 'Which sports are supported?',
    a: 'Basketball, football, and cricket are live today — each with sport-specific event labels and scoring logic.',
  },
  {
    q: 'Can I analyze team sessions?',
    a: 'Yes. Upload one clip, choose a detected athlete, and repeat for each player in the same training set.',
  },
  {
    q: 'Do I get scores and coaching cues?',
    a: 'Yes. Form scores plus direct feedback so athletes know exactly what to change before the next rep.',
  },
]

export default function LandingPage({ onFileSelected }: LandingPageProps) {
  const containerRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')

  // ── Film Grain Canvas ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = document.getElementById('grain-canvas') as HTMLCanvasElement
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    let frameCount = 0
    function drawGrain() {
      frameCount++
      if (frameCount % 3 !== 0) return // Only redraw every 3rd frame for performance
      const w = canvas.width
      const h = canvas.height
      const imageData = ctx!.createImageData(w, h)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        const val = Math.random() * 255
        data[i] = val
        data[i + 1] = val
        data[i + 2] = val
        data[i + 3] = 255
      }
      ctx!.putImageData(imageData, 0, 0)
    }

    let raf: number
    function loop() {
      drawGrain()
      raf = requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    loop()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  // ── GSAP Animations ─────────────────────────────────────────────────────
  useGSAP(() => {
    // Hero entrance
    gsap.from('.hero-line', {
      y: 60,
      opacity: 0,
      duration: 1.2,
      stagger: 0.15,
      ease: 'power3.out',
    })

    // Stats entrance
    gsap.from('.stat-item', {
      y: 30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      delay: 0.6,
      ease: 'power2.out',
    })

    // Scroll-triggered sections — use set() to ensure initial state, then animate
    const sections = gsap.utils.toArray('.scroll-section')
    sections.forEach((section: any) => {
      gsap.set(section, { opacity: 0, y: 40 })
      gsap.to(section, {
        scrollTrigger: {
          trigger: section,
          start: 'top 85%',
        },
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power2.out',
      })
    })

    // Workflow steps
    const steps = gsap.utils.toArray('.workflow-step')
    steps.forEach((step: any, i: number) => {
      gsap.set(step, { opacity: 0, x: -20 })
      gsap.to(step, {
        scrollTrigger: {
          trigger: step,
          start: 'top 90%',
        },
        opacity: 1,
        x: 0,
        duration: 0.6,
        delay: i * 0.08,
        ease: 'power2.out',
      })
    })

    // Feature cards
    const cards = gsap.utils.toArray('.feature-card')
    cards.forEach((card: any, i: number) => {
      gsap.set(card, { opacity: 0, y: 30 })
      gsap.to(card, {
        scrollTrigger: {
          trigger: card,
          start: 'top 90%',
        },
        opacity: 1,
        y: 0,
        duration: 0.6,
        delay: i * 0.1,
        ease: 'power2.out',
      })
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
    <main ref={containerRef} className="relative">
      {/* Film grain */}
      <canvas id="grain-canvas" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--cream-05)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-12">
          <a href="#" className="flex items-center gap-3">
            <span className="font-serif text-xl text-[var(--fg)]">coach.xyz</span>
          </a>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#workflow" className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">
              Workflow
            </a>
            <a href="#features" className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">
              Features
            </a>
            <a href="#faq" className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">
              FAQ
            </a>
          </nav>
          <a
            href="#analyze"
            className="border border-[var(--cream-10)] px-5 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
          >
            Analyze Now
          </a>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[85vh] flex-col justify-end px-6 pb-16 pt-32 lg:px-12 lg:pb-24">
        <div className="mx-auto w-full max-w-7xl">
          <p className="hero-line mb-6 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            AI-Powered Sports Video Analysis
          </p>

          <h1 className="hero-line font-serif text-[clamp(2.5rem,8vw,7rem)] leading-[0.9] tracking-[-0.03em] text-[var(--fg)]">
            Coach smarter.
          </h1>
          <h1 className="hero-line font-serif text-[clamp(2.5rem,8vw,7rem)] leading-[0.9] tracking-[-0.03em] text-[var(--fg)] italic">
            Review faster.
          </h1>

          <div className="hero-line mt-8 max-w-xl">
            <p className="text-sm leading-relaxed text-[var(--cream-40)]">
              Upload training footage. Get timestamped form scores, correction cues, and annotated video — in under 60 seconds.
            </p>
          </div>

          <div className="hero-line mt-10 flex flex-wrap items-center gap-6">
            <a
              href="#analyze"
              className="inline-block bg-[var(--fg)] px-8 py-4 text-[0.7rem] uppercase tracking-[0.2em] text-[var(--bg)] transition-all hover:scale-105"
            >
              Start analyzing
            </a>
            <a
              href="#workflow"
              className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]"
            >
              See how it works →
            </a>
          </div>

          {/* Stats */}
          <div className="hero-line mt-16 flex gap-12 border-t border-[var(--cream-10)] pt-8">
            {stats.map((stat) => (
              <div key={stat.label} className="stat-item">
                <p className="font-serif text-3xl text-[var(--fg)]">{stat.value}</p>
                <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Marquee ────────────────────────────────────────────────────────── */}
      <section className="border-y border-[var(--cream-05)] py-5">
        <div className="marquee-track">
          <span className="marquee-item">Basketball</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Football</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Cricket</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Form Scoring</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Pose Detection</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Video Annotation</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Coaching Feedback</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Gemini AI</span>
          <span className="marquee-item">•</span>
          {/* Duplicate for seamless loop */}
          <span className="marquee-item">Basketball</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Football</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Cricket</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Form Scoring</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Pose Detection</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Video Annotation</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Coaching Feedback</span>
          <span className="marquee-item">•</span>
          <span className="marquee-item">Gemini AI</span>
          <span className="marquee-item">•</span>
        </div>
      </section>

      {/* ── Upload Section ─────────────────────────────────────────────────── */}
      <section id="analyze" className="scroll-section px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left — Info */}
            <div>
              <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
                Get started
              </p>
              <h2 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em]">
                Upload your<br />training clip
              </h2>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--cream-40)]">
                Drop in basketball, football, or cricket footage. The system auto-validates format and detects players before analysis begins.
              </p>

              <div className="mt-10 flex gap-8">
                <div>
                  <p className="font-serif text-2xl">MP4, MOV, AVI</p>
                  <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">Supported formats</p>
                </div>
                <div>
                  <p className="font-serif text-2xl">500MB</p>
                  <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">Max file size</p>
                </div>
              </div>
            </div>

            {/* Right — Upload Zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload sports video"
              onClick={openPicker}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openPicker()
                }
              }}
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
                selectFile(e.dataTransfer.files[0])
              }}
              className={`relative flex min-h-[360px] flex-col items-center justify-center border transition-all duration-500 ${
                isDragging
                  ? 'border-[var(--fg)] bg-[var(--cream-05)]'
                  : 'border-[var(--cream-10)] bg-transparent hover:border-[var(--cream-20)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => selectFile(e.target.files?.[0])}
              />

              {/* Corner accents */}
              <div className="absolute top-3 left-3 h-4 w-4 border-t border-l border-[var(--cream-20)]" />
              <div className="absolute top-3 right-3 h-4 w-4 border-t border-r border-[var(--cream-20)]" />
              <div className="absolute bottom-3 left-3 h-4 w-4 border-b border-l border-[var(--cream-20)]" />
              <div className="absolute bottom-3 right-3 h-4 w-4 border-b border-r border-[var(--cream-20)]" />

              <svg className="mb-6 h-10 w-10 text-[var(--cream-40)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>

              {fileName ? (
                <p className="text-sm text-[var(--fg)]">{fileName}</p>
              ) : (
                <>
                  <p className="font-serif text-xl text-[var(--fg)]">Drop your video here</p>
                  <p className="mt-2 text-[0.65rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">
                    or click to browse
                  </p>
                </>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  openPicker()
                }}
                className="mt-8 border border-[var(--cream-20)] bg-transparent px-8 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
              >
                Choose video
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Workflow ───────────────────────────────────────────────────────── */}
      <section id="workflow" className="scroll-section border-t border-[var(--cream-05)] px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            How it works
          </p>
          <h2 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em]">
            From upload to<br />coaching report
          </h2>

          <div className="mt-16 grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {workflow.map((item, i) => (
              <div
                key={item.step}
                className={`workflow-step border-t border-[var(--cream-10)] py-8 ${
                  i < 3 ? 'lg:border-r lg:border-[var(--cream-10)]' : ''
                } ${i < 2 ? 'sm:border-r sm:border-[var(--cream-10)]' : ''}`}
              >
                <p className="mb-4 font-serif text-4xl text-[var(--cream-20)]">{item.step}</p>
                <h3 className="font-serif text-2xl">{item.title}</h3>
                <p className="mt-3 max-w-[280px] text-sm leading-relaxed text-[var(--cream-40)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="scroll-section border-t border-[var(--cream-05)] px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            Capabilities
          </p>
          <h2 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em]">
            Built for practical<br />coaching sessions
          </h2>

          <div className="mt-16 grid grid-cols-1 gap-px bg-[var(--cream-05)] sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.eyebrow}
                className="feature-card bg-[var(--bg)] p-8 transition-colors hover:bg-[var(--cream-03)]"
              >
                <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
                  {feature.eyebrow}
                </p>
                <h3 className="font-serif text-2xl">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--cream-40)]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sports ─────────────────────────────────────────────────────────── */}
      <section className="scroll-section border-t border-[var(--cream-05)] px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.5fr]">
            <div>
              <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
                Multi-sport
              </p>
              <h2 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em]">
                One platform,<br />three sports
              </h2>
            </div>

            <div className="space-y-0">
              {sports.map((sport, i) => (
                <div
                  key={sport.name}
                  className={`flex flex-col gap-2 border-t border-[var(--cream-10)] py-6 sm:flex-row sm:items-baseline sm:justify-between ${
                    i === sports.length - 1 ? 'border-b' : ''
                  }`}
                >
                  <h3 className="font-serif text-3xl">{sport.name}</h3>
                  <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">
                    {sport.events}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────────────────── */}
      <section className="scroll-section border-t border-[var(--cream-05)] px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-3xl text-center">
          <svg className="mx-auto mb-8 h-8 w-8 text-[var(--cream-20)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
          </svg>
          <p className="font-serif text-[clamp(1.25rem,2.5vw,2rem)] leading-snug italic">
            &ldquo;CoachXYZ cut our review time in half. Players now receive precise fixes the same day instead of waiting for manual notes.&rdquo;
          </p>
          <div className="mt-8">
            <p className="text-sm text-[var(--fg)]">David R.</p>
            <p className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">Performance Coach</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-section border-t border-[var(--cream-05)] px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            FAQ
          </p>
          <h2 className="mb-12 font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em]">
            Questions coaches<br />ask first
          </h2>

          <div className="space-y-0">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group border-t border-[var(--cream-10)] py-5"
              >
                <summary className="flex cursor-pointer items-center justify-between text-sm text-[var(--fg)] transition-colors group-open:text-[var(--cream-40)]">
                  {faq.q}
                  <svg
                    className="h-4 w-4 shrink-0 text-[var(--cream-40)] transition-transform group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--cream-40)]">
                  {faq.a}
                </p>
              </details>
            ))}
            <div className="border-t border-[var(--cream-10)]" />
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="scroll-section px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-7xl border border-[var(--cream-10)] px-6 py-20 text-center lg:px-24">
          <h2 className="font-serif text-[clamp(2rem,5vw,4rem)] leading-[1] tracking-[-0.02em]">
            Build stronger athletes<br />with faster review loops
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-sm text-[var(--cream-40)]">
            Upload the next training clip and generate a complete coaching report before the session ends.
          </p>
          <a
            href="#analyze"
            className="mt-10 inline-block bg-[var(--fg)] px-10 py-5 text-[0.7rem] uppercase tracking-[0.2em] text-[var(--bg)] transition-all hover:scale-105"
          >
            Start analyzing for free
          </a>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--cream-05)] px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-12 md:flex-row">
            <div>
              <p className="font-serif text-lg">coach.xyz</p>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--cream-40)]">
                AI-powered sports video analysis for coaches who want faster feedback and measurable athlete progress.
              </p>
            </div>
            <div className="flex gap-16">
              <div>
                <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--fg)]">Platform</p>
                <div className="space-y-3">
                  <a href="#workflow" className="block text-sm text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">Workflow</a>
                  <a href="#features" className="block text-sm text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">Features</a>
                  <a href="#faq" className="block text-sm text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]">FAQ</a>
                </div>
              </div>
              <div>
                <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--fg)]">Sports</p>
                <div className="space-y-3">
                  <p className="text-sm text-[var(--cream-40)]">Basketball</p>
                  <p className="text-sm text-[var(--cream-40)]">Football</p>
                  <p className="text-sm text-[var(--cream-40)]">Cricket</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-16 border-t border-[var(--cream-05)] pt-8 text-[0.6rem] text-[var(--cream-40)]">
            © {new Date().getFullYear()} CoachXYZ. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  )
}
