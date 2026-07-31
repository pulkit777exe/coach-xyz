'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getDownloadUrl } from '@/lib/api'
import { AppHeader } from '@/components/AppHeader'
import type { JobStatus } from '@/types'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface ResultsSummaryProps {
  status: JobStatus
  jobId: string
  onReset: () => void
  onStartChat?: () => void
}

const SPORT_EMOJI: Record<string, string> = {
  basketball: "🏀",
  football: "⚽",
  cricket: "🏏",
  unknown: "🎯"
}

export default function ResultsSummary({ status, jobId, onReset, onStartChat }: ResultsSummaryProps) {
  const summary = status.summary
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    if (!summary) return
    gsap.from('.gsap-item', {
      y: 30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.15,
      ease: 'power3.out'
    })
  }, { scope: containerRef })
  
  if (!summary) {
    return (
      <>
        <AppHeader />
        <div className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center pt-20">
          <p className="text-[var(--fg)]">No analysis summary available.</p>
          <Button onClick={onReset} className="mt-4">Try again</Button>
        </div>
      </>
    )
  }
  
  const formScoreColor = summary.form_score >= 8 ? 'text-[var(--fg)]' :
    summary.form_score >= 5 ? 'text-amber-400' : 'text-red-400'

  return (
    <>
      <AppHeader />
      <div ref={containerRef} className="min-h-screen bg-transparent p-6 flex flex-col items-center relative z-10 pt-20">

        <div className="max-w-4xl w-full">
          {/* Summary Card */}
          <Card className="gsap-item mb-8 bg-[var(--bg)] border-[var(--cream-10)] relative overflow-hidden">
            <CardHeader className="border-b border-[var(--cream-05)] pb-6 pt-8">
              <CardTitle className="text-3xl text-[var(--fg)] font-serif flex items-center gap-3">
                <span className="text-4xl">{SPORT_EMOJI[summary.sport] || SPORT_EMOJI.unknown}</span>
                <span className="text-[var(--fg)] capitalize">{summary.sport} Analysis Complete</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-8 pt-8">
              {/* Form Score */}
              <div className="grid md:grid-cols-2 gap-8 items-center bg-[var(--cream-05)] rounded-none p-8 border border-[var(--cream-05)]">
                <div className="text-center md:text-left">
                  <p className="text-[var(--cream-40)] font-medium uppercase tracking-widest text-sm mb-2">Total Form Score</p>
                  <div className="flex items-baseline justify-center md:justify-start gap-2">
                    <div className={`text-7xl font-bold font-serif ${formScoreColor}`}>
                      {summary.form_score}
                    </div>
                    <span className="text-xl text-[var(--cream-40)] font-medium font-serif">/ 10</span>
                  </div>
                  <Badge variant="outline" className="mt-4 border-[var(--cream-10)] text-[var(--fg)] bg-[var(--cream-05)] px-4 py-1.5 text-sm uppercase tracking-wide">
                    {summary.overall_rating} Level
                  </Badge>
                </div>
                <div className="text-center md:text-left border-l-0 md:border-l border-[var(--cream-10)] md:pl-8">
                  <p className="text-[var(--cream-40)] font-medium uppercase tracking-widest text-sm mb-3">Overall Assessment</p>
                  <p className="text-[var(--cream-40)] text-lg leading-relaxed">{summary.summary}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Top Tips */}
                <div className="bg-[var(--cream-05)] rounded-none p-6 border border-[var(--cream-05)]">
                  <h3 className="text-lg font-semibold text-[var(--fg)] mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Priority Focus
                  </h3>
                  <ol className="space-y-3">
                    {summary.top_tips?.map((tip, index) => (
                      <li key={index} className="flex gap-3 text-[var(--cream-40)]">
                        <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--cream-05)] border border-[var(--cream-10)] text-xs font-bold text-[var(--cream-40)]">{index + 1}</span>
                        <span className="leading-relaxed">{tip}</span>
                      </li>
                    ))}
                  </ol>
                  {summary.priority_drill && (
                    <div className="mt-6 p-4 rounded-none border border-[var(--cream-10)] bg-[var(--cream-05)]">
                      <p className="text-xs font-semibold text-[var(--cream-40)] uppercase tracking-wider mb-1">Recommended Drill</p>
                      <p className="text-sm text-[var(--cream-40)]">{summary.priority_drill}</p>
                    </div>
                  )}
                </div>

                {/* Strengths */}
                {summary.strengths && summary.strengths.length > 0 && (
                  <div className="bg-[var(--cream-05)] rounded-none p-6 border border-[var(--cream-05)] flex flex-col justify-start">
                    <h3 className="text-lg font-semibold text-[var(--fg)] mb-4 flex items-center gap-2">
                       <svg className="w-5 h-5 text-[var(--fg)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Strengths
                    </h3>
                    <ul className="space-y-3">
                      {summary.strengths.map((strength, index) => (
                        <li key={index} className="flex gap-3 text-[var(--cream-40)] items-start">
                          <span className="text-[var(--fg)] mt-1 shrink-0">❖</span>
                          <span className="leading-relaxed">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className={`gsap-item gap-4 mb-8 ${onStartChat ? 'grid sm:grid-cols-3' : 'grid sm:grid-cols-2'}`}>
            {onStartChat && (
              <Button
                className="button-accent h-16 rounded-none text-base font-bold transition-transform hover:scale-[1.02]"
                onClick={onStartChat}
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                Chat with AI
              </Button>
            )}
            
            <a
              href={getDownloadUrl(jobId)}
              download="coachai_analysis.mp4"
              className="flex-1 block group"
            >
              <Button className="w-full h-16 rounded-none text-base font-bold transition-transform group-hover:scale-[1.02] bg-[var(--fg)] text-[var(--bg)]">
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download Video
              </Button>
            </a>
            
            <Button
              variant="outline"
              className="h-16 rounded-none bg-[var(--cream-05)] border-[var(--cream-10)] text-[var(--fg)] font-semibold hover:bg-[var(--cream-10)] hover:border-[var(--cream-20)] hover:text-[var(--fg)] transition-all"
              onClick={onReset}
            >
              <svg className="w-5 h-5 mr-3 text-[var(--cream-40)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              New Analysis
            </Button>
          </div>

          {/* Shot Events */}
          {summary.shot_events && summary.shot_events.length > 0 && (
            <div className="gsap-item mb-12">
              <details className="group border border-[var(--cream-10)] rounded-none bg-[var(--bg)] [&_summary::-webkit-details-marker]:hidden transition-all open:bg-[var(--cream-05)]" open>
                <summary className="cursor-pointer p-6 flex flex-wrap items-center justify-between gap-4 select-none">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--cream-05)] border border-[var(--cream-10)] text-[var(--fg)]">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-serif font-bold text-[var(--fg)] leading-none">
                        Event Timeline
                      </h3>
                      <p className="text-[var(--cream-40)] font-medium text-sm mt-1">{summary.shot_events.length} events analyzed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[var(--cream-40)] group-open:hidden">Tap to view breakdown</span>
                    <svg className="w-6 h-6 text-[var(--cream-40)] group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </summary>
                <div className="px-6 pb-6 pt-2 space-y-4 border-t border-[var(--cream-05)] mt-2">
                  {summary.shot_events.map((event, index) => {
                     const colorClass = event.form_score >= 8 ? 'text-[var(--fg)] bg-[var(--cream-05)] border-[var(--cream-10)]' :
                     event.form_score >= 5 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'
                    
                    return (
                      <div key={index} className="flex gap-5 p-5 rounded-none border border-[var(--cream-05)] bg-[var(--cream-05)] hover:bg-[var(--cream-10)] transition-colors">
                        <div className="shrink-0 flex flex-col items-center">
                          <span className="text-sm font-mono font-bold text-[var(--cream-40)] bg-[var(--cream-05)] px-2 py-1 rounded-none">{event.timestamp?.toFixed(1) ?? '0.0'}s</span>
                          {index !== summary.shot_events.length - 1 && (
                            <div className="w-px h-full bg-[var(--cream-10)] my-3"></div>
                          )}
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <Badge variant="secondary" className="bg-[var(--cream-05)] text-[var(--cream-40)] border border-[var(--cream-10)] capitalize hover:bg-[var(--cream-10)] px-3 py-1 text-xs tracking-wide">
                              {event.event_type?.replace('_', ' ') || 'Action'}
                            </Badge>
                            <Badge variant="outline" className={`font-mono text-xs shadow-sm px-3 py-1 uppercase tracking-widest font-bold ${colorClass}`}>
                              Score: {event.form_score}/10
                            </Badge>
                          </div>
                          {event.key_observation && (
                            <p className="text-sm font-bold text-[var(--cream-40)] mb-2 border-l-2 border-[var(--cream-20)] pl-3">{event.key_observation}</p>
                          )}
                          <p className="text-[var(--cream-40)] text-sm leading-relaxed pl-3">{event.feedback}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
