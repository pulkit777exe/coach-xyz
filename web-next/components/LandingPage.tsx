'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { MAX_FILE_SIZE_BYTES } from '@/types'
import { Button } from '@/components/9ui/ui/button'
import { ArrowRight, Check, Copy, Play, ChevronDown } from 'lucide-react'

interface LandingPageProps { onFileSelected: (file: File) => void }

export default function LandingPage({ onFileSelected }: LandingPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [subscribeEmail, setSubscribeEmail] = useState('')
  const copy = (v: string, id: string) => { navigator.clipboard.writeText(v); setCopied(id); setTimeout(()=>setCopied(null), 1400) }
  const subscribe = (e: React.FormEvent) => {
    e.preventDefault()
    const query = new URLSearchParams({ subject: 'Newsletter signup', body: subscribeEmail.trim() })
    window.location.href = `mailto:hello@coachxyz.app?${query.toString()}`
  }

  const pick = (f?: File) => {
    if (!f) return
    setFileError(null)
    if (!f.type.startsWith('video/')) { setFileError('Please select a video file (MP4, MOV, AVI, MKV).'); return }
    if (f.size > MAX_FILE_SIZE_BYTES) { setFileError('File exceeds 500 MB limit.'); return }
    setFileName(f.name); onFileSelected(f)
  }
  const open = () => fileInputRef.current?.click()

  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)] antialiased selection:bg-primary/30 selection:text-[var(--marketing-brown)]">
      {/* nav is rendered by HeaderClient for marketing routes */}
      {/* hero */}
      <section className="relative overflow-hidden bg-[var(--marketing-dark)] px-6 pb-8 pt-10 lg:px-8">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 left-1/2 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-success/[0.07] blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-[1120px]">
          <div className="mx-auto max-w-[760px] text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">AI-POWERED COACHING</p>
            <h1 className="mt-3 text-balance text-[30px] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--marketing-beige)] sm:text-[42px] lg:text-[48px]">
              We build coaching that <span className="text-primary">unlocks more</span> efficient performance
            </h1>
            <p className="mx-auto mt-4 max-w-[620px] text-sm leading-6 text-[var(--marketing-beige)]/70">
              Upload training footage. Get timestamped form scores, correction cues, and annotated video — in under 60 seconds. Six sports, one pipeline.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={open} className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90">Start analyzing for free</Button>
              <Button variant="outline" onClick={()=>document.getElementById('analyze')?.scrollIntoView({behavior:'smooth'})} className="h-10 rounded-full border-[var(--marketing-beige)]/20 bg-transparent px-6 text-sm text-[var(--marketing-beige)] hover:bg-white/5 hover:text-[var(--marketing-beige)]">See how it works</Button>
            </div>
          </div>

          {/* phone mocks */}
          <div className="mt-8 flex justify-center gap-3 overflow-x-auto pb-2">
            {['Analysis', 'Scores', 'Chat', 'Video', 'Report'].map((k,i)=>(
              <div key={k} className={`hidden h-[220px] w-[140px] shrink-0 rounded-[18px] border border-[var(--marketing-beige)]/10 bg-gradient-to-b from-[var(--marketing-dark-card)] to-[var(--marketing-dark)] p-3 sm:flex ${i===2?'scale-[1.05] border-primary/30':''}`}>
                <div className="w-full rounded-xl bg-black/40 p-2">
                  <div className="h-2 w-10 rounded-full bg-white/10 mx-auto mb-3" />
                  <p className="text-[10px] font-semibold text-[var(--marketing-beige)]">{k}</p>
                  <div className="mt-2 space-y-1.5">
                    <div className="h-2 rounded bg-primary/20" />
                    <div className="h-2 rounded bg-white/5 w-3/4" />
                    <div className="mt-3 h-16 rounded bg-black/20 border border-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 border-t border-[var(--marketing-beige)]/10 pt-6 text-[11px] font-bold tracking-[0.16em] text-[var(--marketing-beige)]/30">
            <span>TRUSTED BY</span>
            {['karbon','Bondly','GLOBHE','roman'].map(s=> <span key={s} className="font-semibold tracking-widest">{s.toUpperCase()}</span>)}
          </div>
        </div>
      </section>

      {/* 4 reasons — dark */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-center text-[20px] font-bold tracking-tight text-[var(--marketing-beige)]">4 Reasons Why You Should Use <span className="text-primary">CoachXYZ</span> to Build Coaching</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {n:'1',t:'We believe in full-funnel', d:'From upload to annotated video and shareable report — no gaps.'},
              {n:'2',t:'We focus on adopting your workflow', d:'Roster, attendance, schedule and video analysis in one place.'},
              {n:'3',t:'Even our grandparents can use it', d:'Drag, drop, select player, get results. No manual tagging.'},
              {n:'4',t:'Designed specifically to match your sport', d:'Basketball, football, cricket, tennis, baseball, hockey — sport-aware.'},
            ].map(c=>(
              <div key={c.n} className="rounded-2xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-5">
                <div className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-[var(--marketing-brown)]">{c.n}</div>
                <p className="mt-3 text-sm font-semibold leading-tight text-[var(--marketing-beige)]">{c.t}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--marketing-beige)]/60">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* why you should — graph */}
      <section className="bg-[var(--marketing-dark)] px-6 pb-6 lg:px-8">
        <div className="mx-auto max-w-[1120px] rounded-2xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-6 lg:p-8">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-beige)]">Here&apos;s why you should use CoachXYZ coaching</h3>
          <div className="relative mt-8 h-[120px] overflow-hidden rounded-xl border border-[var(--marketing-beige)]/5 bg-[var(--marketing-dark)] p-4">
            <div className="absolute left-6 right-6 top-1/2 h-[2px] -translate-y-1/2 bg-gradient-to-r from-primary via-success to-destructive/60" />
            <div className="relative flex h-full items-center justify-between">
              {[
                {l:'Upload', c:'var(--primary)'},
                {l:'Detect', c:'var(--primary)'},
                {l:'Analyze', c:'var(--success)'},
                {l:'Deliver', c:'var(--destructive)'},
              ].map(s=>(
                <div key={s.l} className="flex flex-col items-center gap-2">
                  <div className="size-3 rounded-full border-2 bg-[var(--marketing-dark)]" style={{borderColor:s.c, boxShadow:`0 0 0 4px color-mix(in srgb, ${s.c} 13%, transparent)`}} />
                  <span className="text-[11px] font-semibold tracking-wide text-[var(--marketing-beige)]/70">{s.l}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-[var(--marketing-beige)]/50">Upload → Detect players → Gemini analysis → Annotated video + report</p>
        </div>
      </section>

      {/* lime CTA bar */}
      <section className="bg-[var(--marketing-dark)] px-6 pb-8 lg:px-8">
        <div className="mx-auto max-w-[1120px] rounded-2xl bg-primary p-6 text-center lg:p-7">
          <p className="text-sm font-bold text-[var(--marketing-brown)]">Ready to build coaching that increases ADV, ROAS, and your athletes&apos; happiness? <span>🎉</span></p>
          <Button onClick={open} className="mt-3 h-8 rounded-full bg-[var(--marketing-brown)] px-5 text-xs font-semibold text-[var(--marketing-beige)] hover:bg-black hover:text-[var(--marketing-brown)]">Start analyzing — free</Button>
        </div>
      </section>

      {/* experts — dark with image */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-8 rounded-2xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
          <div>
            <h3 className="text-[22px] font-bold leading-tight text-[var(--marketing-beige)]">We are the experts<br/>in coaching that <span className="text-primary">convert</span>.</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--marketing-beige)]/60">After 10k+ analyses, we know what makes feedback stick. Clear scores, one priority drill, and video overlays athletes replay.</p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--marketing-beige)]/70">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-primary"/> Event timeline for every rep</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-primary"/> Session summary with strengths & fixes</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-primary"/> Annotated video renders</li>
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-xl bg-[var(--marketing-dark)] p-2">
            <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-success/20 to-destructive/10 border border-white/5 flex items-center justify-center">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-[var(--marketing-brown)]">Coach</span>
            </div>
            <div className="absolute bottom-3 right-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[var(--marketing-brown)] shadow">Trusted by 2,400+ coaches</div>
          </div>
        </div>
      </section>

      {/* results — WHITE */}
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-[18px] font-bold text-[var(--marketing-brown)]">As you can see for yourself,<br/>we get results</h3>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {k:'37%', d:'faster review loops on average'},
              {k:'22%', d:'higher attendance after 4 weeks'},
              {k:'17%', d:'form score improvement (median)'},
              {k:'246%', d:'more video feedback shared per month'},
            ].map(s=>(
              <div key={s.k} className="rounded-2xl bg-[var(--marketing-dark)] p-6 text-center border border-[var(--marketing-dark)]">
                <p className="text-[28px] font-bold tracking-tight text-primary">{s.k}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--marketing-beige)]/70">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* what happens — dark vertical timeline */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-beige)]">What happens when you purchase a Coaching Analysis</h3>
          <div className="relative mx-auto mt-8 max-w-[760px]">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-primary via-success to-destructive/40 sm:left-1/2 sm:-translate-x-px" />
            {[
              {n:'1',t:'Upload your clip',d:'Drag MP4/MOV/AVI up to 500 MB. Auto-validated.'},
              {n:'2',t:'We detect every athlete',d:'MediaPipe finds each player with boxes + confidence.'},
              {n:'3',t:'Gemini scores & corrects',d:'Form, mechanics and timing across keyframes.'},
              {n:'4',t:'You get annotated video',d:'Pose overlays, HUD stats, coaching cues.'},
              {n:'5',t:'Share & track progress',d:'Link to roster, reports and trends.'},
            ].map((s,i)=>(
              <div key={s.n} className={`relative flex gap-4 py-6 ${i%2===0?'sm:flex-row':'sm:flex-row-reverse'}`}>
                <div className={`flex-1 ${i%2===0?'sm:text-right':''}`}>
                  <div className={`rounded-xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-4 ${i%2===0?'sm:ml-auto':''} sm:max-w-[320px]`}>
                    <p className="text-sm font-semibold text-[var(--marketing-beige)]">{s.n}. {s.t}</p>
                    <p className="mt-1 text-xs text-[var(--marketing-beige)]/60">{s.d}</p>
                  </div>
                </div>
                <div className="absolute left-4 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-xs font-bold text-[var(--marketing-brown)] sm:left-1/2">{s.n}</div>
                <div className="flex-1 hidden sm:block" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* analyze dropzone — lime-accented dark */}
      <section id="analyze" className="bg-[var(--marketing-dark)] px-6 pb-8 lg:px-8">
        <div className="mx-auto max-w-[760px] rounded-2xl border border-primary/20 bg-[var(--marketing-dark-card)] p-6">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-beige)]">Drop your training video here</h3>
          <p className="text-center text-sm text-[var(--marketing-beige)]/60">Six sports • Auto player detection • 60s analysis</p>
          <div
            role="button" tabIndex={0} onClick={open} onKeyDown={e=>{ if(e.key==='Enter'||e.key===' ') {e.preventDefault(); open()}}}
            onDragOver={e=>{e.preventDefault(); setIsDragging(true)}} onDragLeave={e=>{e.preventDefault(); setIsDragging(false)}} onDrop={e=>{e.preventDefault(); setIsDragging(false); pick(e.dataTransfer.files[0])}}
            className={`mt-5 flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${isDragging?'border-primary bg-primary/10':'border-[var(--marketing-beige)]/15 bg-[var(--marketing-dark)] hover:border-primary/30'}`}
          >
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={e=>pick(e.target.files?.[0])} />
            <div className="grid size-12 place-items-center rounded-full bg-primary text-[var(--marketing-brown)]"><Play className="size-5 translate-x-[1px]" /></div>
            <p className="mt-3 text-sm font-semibold text-[var(--marketing-beige)]">{fileName || 'Drop video or click to browse'}</p>
            <p className="text-xs text-[var(--marketing-beige)]/50">MP4, MOV, AVI • 500 MB max</p>
            <Button size="sm" className="mt-4 rounded-full bg-primary px-6 text-xs font-semibold text-[var(--marketing-brown)] hover:bg-primary/90">Choose video</Button>
            {fileError && <p className="mt-2 text-xs text-destructive">{fileError}</p>}
          </div>
        </div>
      </section>

      {/* case studies — white */}
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-brown)]">Case studies</h3>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-[var(--marketing-beige)] bg-white">
              <div className="h-40 bg-[var(--marketing-beige)] border-b border-[var(--marketing-beige)]" />
              <div className="p-5">
                <p className="text-sm font-semibold text-[var(--marketing-brown)]">Academy sprint analysis</p>
                <p className="mt-1 text-xs text-[var(--marketing-brown)]/60">How a U16 squad cut review time by 37% in 3 weeks.</p>
                <div className="mt-3 flex gap-6 text-xs"><span><strong className="text-success">74%</strong> faster feedback</span><span><strong className="text-success">32%</strong> attendance up</span></div>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--marketing-beige)] bg-white p-5">
              <p className="text-sm font-semibold text-[var(--marketing-brown)]">Hockey wrist-shot correction</p>
              <p className="mt-1 text-xs text-[var(--marketing-brown)]/60">From 4.2 → 7.8 form score after targeted drills.</p>
              <Button size="sm" render={<Link href="/blog" />} className="mt-4 rounded-full bg-primary text-[var(--marketing-brown)] hover:bg-primary/90">Read case study <ArrowRight className="ml-1 size-3"/></Button>
            </div>
          </div>
        </div>
      </section>

      {/* our solution — dark */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-6 rounded-2xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
          <div>
            <h3 className="text-[18px] font-bold leading-tight text-[var(--marketing-beige)]">Our coaching<br/>page solution</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--marketing-beige)]/60">We build digital coaching through data — roster, attendance, schedule and analysis in one stack. Privacy-first, shareable, and exportable.</p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--marketing-beige)]/70">
              <li className="flex gap-2"><Check className="size-4 text-primary"/> Role-based player portals</li>
              <li className="flex gap-2"><Check className="size-4 text-primary"/> One-click reports</li>
              <li className="flex gap-2"><Check className="size-4 text-primary"/> Video overlays & HUD</li>
            </ul>
          </div>
          <div className="rounded-xl bg-primary p-5 text-[var(--marketing-brown)]">
            <p className="text-xs font-bold uppercase tracking-widest">What&apos;s included</p>
            <ul className="mt-3 space-y-2 text-sm font-medium">
              <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--marketing-brown)]"/> Roster & attendance</li>
              <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--marketing-brown)]"/> Schedule & events</li>
              <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--marketing-brown)]"/> 6-sport analysis</li>
              <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--marketing-brown)]"/> Player hub & chat</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Button size="sm" render={<Link href="/features" />} className="rounded-full bg-[var(--marketing-brown)] text-[var(--marketing-beige)] hover:bg-black">Explore <ArrowRight className="ml-1 size-3"/></Button>
              <button onClick={()=>copy('npm i @coachxyz/sdk','sdk2')} className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--marketing-brown)]/20 px-3 text-xs font-medium">{copied? 'Copied':'Copy'} <Copy className="size-3"/></button>
            </div>
          </div>
        </div>
      </section>

      {/* tech stack — white */}
      <section className="bg-[var(--marketing-light)] px-6 py-8 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <h3 className="text-sm font-bold tracking-tight text-[var(--marketing-brown)]">We plug into your tech stack</h3>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-[11px] font-semibold tracking-widest text-[var(--marketing-brown)]/50">
            {['webflow','hubspot','zapier','slack','intercom','notion','google','segment'].map(s=> <span key={s} className="rounded-full border border-[var(--marketing-beige)] bg-white px-3 py-1">{s}</span>)}
          </div>
        </div>
      </section>

      {/* compare — white */}
      <section className="bg-[var(--marketing-light)] px-6 pb-8 lg:px-8">
        <div className="mx-auto max-w-[760px] overflow-hidden rounded-2xl border border-[var(--marketing-beige)] bg-white">
          <div className="grid grid-cols-3 text-xs">
            <div className="p-4 font-semibold text-[var(--marketing-brown)]">How we compare</div>
            <div className="bg-primary p-4 text-center font-bold text-[var(--marketing-brown)]">CoachXYZ</div>
            <div className="p-4 text-center font-medium text-[var(--marketing-brown)]/60">Others</div>
            {[
              ['Setup time','< 1 day','2-4 weeks'],
              ['Sports supported','6 native','1-2 generic'],
              ['Player linking','Email auto','Manual'],
            ].map(row=>(
              <div key={row[0]} className="contents">
                <div className="border-t border-[var(--marketing-beige)]/60 p-3 text-xs text-[var(--marketing-brown)]/70">{row[0]}</div>
                <div className="border-t border-[var(--marketing-beige)]/60 bg-primary/20 p-3 text-center text-xs font-semibold text-[var(--marketing-brown)]">{row[1]}</div>
                <div className="border-t border-[var(--marketing-beige)]/60 p-3 text-center text-xs text-[var(--marketing-brown)]/50">{row[2]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* testimonials — dark */}
      <section className="bg-[var(--marketing-dark)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-beige)]">What others have to say about working with CoachXYZ</h3>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {q:'CoachXYZ cut our review time in half. Players get precise fixes same day.',a:'David R., Performance Coach'},
              {q:'The parent feedback loop is now async — we share reports, they see progress.',a:'Ana M., Academy Director'},
              {q:'Attendance + video in one place. No more spreadsheets.',a:'James L., Head Coach'},
            ].map(c=>(
              <div key={c.q} className="rounded-2xl border border-[var(--marketing-beige)]/10 bg-[var(--marketing-dark-card)] p-5">
                <p className="text-sm leading-6 text-[var(--marketing-beige)]/80">“{c.q}”</p>
                <p className="mt-3 text-xs text-[var(--marketing-beige)]/40">— {c.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — white */}
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[760px]">
          <h3 className="text-center text-lg font-bold text-[var(--marketing-brown)]">Frequently Asked Questions</h3>
          <div className="mt-6 divide-y divide-[var(--marketing-beige)]">
            {[
              {q:'Why is AI analysis your personal platform to develop coaching?',a:'Every rep is scored, timestamped and explained — no manual tagging.'},
              {q:'How do I use the embedded analytics dashboard?',a:'Connect roster, schedule sessions, and generate reports in one click.'},
              {q:'How is feedback personal for the student?',a:'Linked player hub shows only that athlete’s video, scores and reports.'},
            ].map((f,i)=>(
              <div key={f.q} className="py-4">
                <button onClick={()=>setOpenFaq(openFaq===i?null:i)} className="flex w-full items-center justify-between text-left">
                  <span className="text-sm font-medium text-[var(--marketing-brown)]">{f.q}</span>
                  <ChevronDown className={`size-4 text-success transition ${openFaq===i?'rotate-180':''}`} />
                </button>
                {openFaq===i && <p className="mt-2 text-sm leading-6 text-[var(--marketing-brown)]/60">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final split CTA */}
      <section className="bg-[var(--marketing-light)] px-6 pb-8 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-primary p-6">
            <h3 className="text-lg font-bold leading-tight text-[var(--marketing-brown)]">Ready to make your<br/>training more efficient?</h3>
            <Button onClick={open} className="mt-4 rounded-full bg-[var(--marketing-brown)] px-5 text-xs font-semibold text-[var(--marketing-beige)] hover:bg-black">Start for free</Button>
          </div>
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[var(--marketing-dark-card)] p-6 text-center border border-[var(--marketing-dark-card)]">
            <p className="text-sm font-semibold text-[var(--marketing-beige)]">Not ready to buy yet?</p>
            <p className="text-xs text-[var(--marketing-beige)]/60">Book a call with our coaching specialist</p>
            <Button variant="outline" render={<Link href="/contact" />} className="mt-3 rounded-full border-[var(--marketing-beige)]/20 text-[var(--marketing-beige)] hover:bg-white/5">Book a call</Button>
          </div>
        </div>
      </section>

      <footer className="bg-[var(--marketing-dark)] px-6 py-8 lg:px-8 border-t border-[var(--marketing-dark-card)]">
        <div className="mx-auto grid max-w-[1120px] gap-8 md:grid-cols-4">
          <div><p className="text-sm font-bold text-[var(--marketing-beige)]">coach.xyz</p><p className="mt-2 max-w-[280px] text-xs leading-5 text-[var(--marketing-beige)]/40">AI-powered sports video analysis for coaches who want faster feedback.</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-beige)]">Platform</p><div className="mt-3 space-y-2 text-xs text-[var(--marketing-beige)]/50"><a href="/features" className="block hover:text-[var(--marketing-beige)]">Workflow</a><a href="/features" className="block hover:text-[var(--marketing-beige)]">Features</a><a href="/pricing" className="block hover:text-[var(--marketing-beige)]">Pricing</a></div></div>
          <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-beige)]">Company</p><div className="mt-3 space-y-2 text-xs text-[var(--marketing-beige)]/50"><a href="/about" className="block hover:text-[var(--marketing-beige)]">About</a><a href="/blog" className="block hover:text-[var(--marketing-beige)]">Blog</a><a href="/contact" className="block hover:text-[var(--marketing-beige)]">Contact</a></div></div>
          <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-beige)]">Get updates</p><form onSubmit={subscribe} className="mt-3 flex gap-2"><input value={subscribeEmail} onChange={e=>setSubscribeEmail(e.target.value)} type="email" required placeholder="you@academy.com" className="h-8 flex-1 rounded-full border border-[var(--marketing-beige)]/15 bg-transparent px-3 text-xs text-[var(--marketing-beige)] placeholder:text-[var(--marketing-beige)]/30" /><Button type="submit" size="sm" className="h-8 rounded-full bg-primary px-4 text-xs font-semibold text-[var(--marketing-brown)]">Subscribe</Button></form></div>
        </div>
        <div className="mx-auto mt-8 flex max-w-[1120px] items-center justify-between border-t border-[var(--marketing-dark-card)] pt-6 text-xs text-[var(--marketing-beige)]/30">
          <span>© {new Date().getFullYear()} CoachXYZ</span><a href="/privacy" className="hover:text-[var(--marketing-beige)]">Privacy</a><span>•</span><a href="/terms" className="hover:text-[var(--marketing-beige)]">Terms</a>
        </div>
      </footer>
    </main>
  )
}
