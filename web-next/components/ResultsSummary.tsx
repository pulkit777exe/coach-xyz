'use client'

import { useRef, useState, useEffect } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Badge } from '@/components/9ui/ui/badge'
import { Button } from '@/components/9ui/ui/button'
import { getAuthorizedDownloadUrl, getDownloadUrl } from '@/lib/api'
import FindingsTimeline from '@/components/FindingsTimeline'
import type { JobStatus } from '@/types'
import { SPORT_EMOJI } from '@/lib/sports'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface ResultsSummaryProps {
  status: JobStatus
  jobId: string
  onReset: () => void
  onStartChat?: () => void
}

export default function ResultsSummary({
  status,
  jobId,
  onReset,
  onStartChat,
}: ResultsSummaryProps) {
  const summary = status.summary
  const containerRef = useRef<HTMLDivElement>(null)
  const [downloadUrl, setDownloadUrl] = useState(() => getDownloadUrl(jobId))
  const [downloadUrlJob, setDownloadUrlJob] = useState(jobId)
  if (downloadUrlJob !== jobId) {
    setDownloadUrlJob(jobId)
    setDownloadUrl(getDownloadUrl(jobId))
  }
  useEffect(() => {
    let cancelled = false
    void getAuthorizedDownloadUrl(jobId).then((url) => {
      if (!cancelled) setDownloadUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [jobId])

  useGSAP(
    () => {
      if (!summary) return
      gsap.from('.gsap-item', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: 'power3.out',
      })
    },
    { scope: containerRef },
  )

  if (!summary) {
    return (
      <>
        <div className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center pt-20">
          <p className="text-foreground">No analysis summary available.</p>
          <Button onClick={onReset} className="mt-4">
            Try again
          </Button>
        </div>
      </>
    )
  }

  const formScoreColor =
    summary.form_score >= 8
      ? 'text-foreground'
      : summary.form_score >= 5
        ? 'text-warning'
        : 'text-destructive'

  return (
    <>
      <div
        ref={containerRef}
        className="min-h-screen bg-transparent p-6 flex flex-col items-center relative z-10 pt-20"
      >
        <div className="max-w-4xl w-full">
          <div className="gsap-item mb-8 rounded-2xl border border-border bg-card p-6 shadow-sm relative overflow-hidden">
            <div className="border-b border-border pb-6 pt-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <span className="text-4xl">
                  {SPORT_EMOJI[summary.sport] || SPORT_EMOJI.unknown}
                </span>
                <span className="text-foreground capitalize">
                  {summary.sport} Analysis Complete
                </span>
              </h2>
              {summary.angle && summary.angle !== 'primary' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Analyzed perspective:{' '}
                  <span className="font-semibold text-foreground capitalize">{summary.angle}</span>
                </p>
              )}
            </div>
            <div className="space-y-8 pt-8">
              <div className="grid md:grid-cols-2 gap-8 items-center bg-muted rounded-2xl p-8 border border-border">
                <div className="text-center md:text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                    Total Form Score
                  </p>
                  <div className="flex items-baseline justify-center md:justify-start gap-2">
                    <div className={`text-7xl font-bold ${formScoreColor}`}>
                      {summary.form_score}
                    </div>
                    <span className="text-xl text-muted-foreground font-medium">/ 10</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="mt-4 border-border text-foreground bg-muted px-4 py-1.5 text-sm uppercase tracking-wide"
                  >
                    {summary.overall_rating} Level
                  </Badge>
                  {summary.needs_review && (
                    <Badge
                      variant="outline"
                      className="mt-4 ml-2 border-warning/40 text-warning bg-warning/10 px-4 py-1.5 text-sm uppercase tracking-wide"
                    >
                      Needs review
                    </Badge>
                  )}
                </div>
                <div className="text-center md:text-left border-l-0 md:border-l border-border md:pl-8">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                    Overall Assessment
                  </p>
                  <p className="text-muted-foreground text-lg leading-relaxed">{summary.summary}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-muted rounded-2xl p-6 border border-border">
                  <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <svg
                      className="w-5 h-5 text-amber-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Priority Focus
                  </h3>
                  <ol className="space-y-3">
                    {summary.top_tips?.map((tip, index) => (
                      <li key={index} className="flex gap-3 text-muted-foreground">
                        <span className="shrink-0 size-8 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="leading-relaxed">{tip}</span>
                      </li>
                    ))}
                  </ol>
                  {summary.priority_drill && (
                    <div className="mt-6 p-4 rounded-2xl border border-border bg-muted">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Recommended Drill
                      </p>
                      <p className="text-sm text-muted-foreground">{summary.priority_drill}</p>
                    </div>
                  )}
                </div>

                {summary.strengths && summary.strengths.length > 0 && (
                  <div className="bg-muted rounded-2xl p-6 border border-border flex flex-col justify-start">
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <svg
                        className="w-5 h-5 text-foreground"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Strengths
                    </h3>
                    <ul className="space-y-3">
                      {summary.strengths.map((strength, index) => (
                        <li key={index} className="flex gap-3 text-muted-foreground items-start">
                          <span className="text-primary mt-1 shrink-0">•</span>
                          <span className="leading-relaxed">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          {summary.recommended_angles && summary.recommended_angles.length > 0 && (
            <div className="gsap-item mb-8 rounded-2xl border border-border bg-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Film next for a fuller picture
              </h3>
              <ul className="space-y-3 mt-4">
                {summary.recommended_angles.map((angle) => (
                  <li key={angle.id} className="flex gap-3 text-sm">
                    <span className="shrink-0 rounded-full bg-muted border border-border px-3 py-1 font-semibold text-foreground capitalize h-fit">
                      {angle.label}
                    </span>
                    <span className="leading-relaxed text-muted-foreground">
                      {angle.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.findings && summary.findings.length > 0 && (
            <div className="gsap-item mb-8">
              <FindingsTimeline findings={summary.findings} />
            </div>
          )}

          <div
            className={`gsap-item gap-4 mb-8 ${onStartChat ? 'grid sm:grid-cols-3' : 'grid sm:grid-cols-2'}`}
          >
            {onStartChat && (
              <Button
                className="h-16 rounded-xl text-base font-bold transition-colors"
                onClick={onStartChat}
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                Chat with AI
              </Button>
            )}

            <a href={downloadUrl} download="coachai_analysis.mp4" className="flex-1 block group">
              <Button className="w-full h-16 rounded-xl text-base font-bold transition-colors">
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download Video
              </Button>
            </a>

            <Button
              variant="outline"
              className="h-16 rounded-xl bg-muted border-border text-foreground font-semibold hover:bg-accent transition-all"
              onClick={onReset}
            >
              <svg
                className="w-5 h-5 mr-3 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              New Analysis
            </Button>
          </div>

          {summary.shot_events && summary.shot_events.length > 0 && (
            <div className="gsap-item mb-12">
              <details
                className="group rounded-2xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden transition-all open:bg-muted"
                open
              >
                <summary className="cursor-pointer p-6 flex flex-wrap items-center justify-between gap-4 select-none">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border text-foreground">
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-foreground leading-none">
                        Event Timeline
                      </h3>
                      <p className="text-muted-foreground font-medium text-sm mt-1">
                        {summary.shot_events.length} events analyzed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground group-open:hidden">
                      Tap to view breakdown
                    </span>
                    <svg
                      className="w-6 h-6 text-muted-foreground group-open:rotate-180 transition-transform"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </summary>
                <div className="px-6 pb-6 pt-2 space-y-4 border-t border-border mt-2">
                  {summary.shot_events.map((event, index) => {
                    const colorClass =
                      event.form_score >= 8
                        ? 'text-foreground bg-muted border-border'
                        : event.form_score >= 5
                          ? 'text-warning bg-warning/10 border-warning/20'
                          : 'text-destructive bg-destructive/10 border-destructive/20'

                    return (
                      <div
                        key={index}
                        className="flex gap-5 p-5 rounded-2xl border border-border bg-muted hover:bg-accent transition-colors"
                      >
                        <div className="shrink-0 flex flex-col items-center">
                          <span className="text-sm font-mono font-bold text-muted-foreground bg-muted px-2 py-1 rounded-lg">
                            {event.timestamp?.toFixed(1) ?? '0.0'}s
                          </span>
                          {index !== summary.shot_events.length - 1 && (
                            <div className="w-px h-full bg-border my-3"></div>
                          )}
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <Badge
                              variant="secondary"
                              className="bg-muted text-muted-foreground border border-border capitalize px-3 py-1 text-xs tracking-wide"
                            >
                              {event.event_type?.replace('_', ' ') || 'Action'}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`font-mono text-xs shadow-sm px-3 py-1 uppercase tracking-widest font-bold ${colorClass}`}
                            >
                              Score: {event.form_score}/10
                            </Badge>
                          </div>
                          {event.key_observation && (
                            <p className="text-sm font-bold text-muted-foreground mb-2 border-l-2 border-border pl-3">
                              {event.key_observation}
                            </p>
                          )}
                          <p className="text-muted-foreground text-sm leading-relaxed pl-3">
                            {event.feedback}
                          </p>
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
