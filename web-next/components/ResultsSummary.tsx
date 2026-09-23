'use client'

import { useRef, useState, useEffect } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Button } from '@/components/9ui/ui/button'
import StatusPill from '@/components/org/StatusPill'
import { getAuthorizedDownloadUrl, getDownloadUrl } from '@/lib/api'
import FindingsTimeline from '@/components/FindingsTimeline'
import TimestampPill from '@/components/TimestampPill'
import type { JobStatus } from '@/types'
import { SPORT_EMOJI } from '@/lib/sports'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

const QUALITY_ISSUE_LABELS: Record<string, string> = {
  missing_summary: 'unreadable summary',
  missing_sport: 'sport not detected',
  missing_form_score: 'score missing',
  form_score_out_of_range: 'score out of range',
  invalid_overall_rating: 'rating invalid',
  missing_shot_events: 'no events detected',
  malformed_shot_event: 'event data malformed',
  event_missing_timestamp: 'event timestamp missing',
  event_timestamp_out_of_range: 'event outside video',
  event_count_mismatch: 'event count mismatch',
  missing_findings: 'no findings derived',
  malformed_finding: 'finding data malformed',
  unsupported_strong_claim: 'claim needs evidence',
  invalid_review_state: 'review state invalid',
}

function humanizeQualityIssue(code: string): string {
  return QUALITY_ISSUE_LABELS[code] ?? code.replace(/_/g, ' ')
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
        y: 24,
        opacity: 0,
        duration: 0.3,
        stagger: 0.05,
        ease: 'power2.out',
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
          <div className="gsap-item mb-8 rounded-[6px] border border-border bg-card p-6 relative overflow-hidden">
            <div className="border-b border-border pb-6 pt-2">
              <h2 className="text-[26px] sm:text-[30px] font-bold tracking-[-0.015em] text-foreground flex items-center gap-3">
                <span className="text-4xl">
                  {SPORT_EMOJI[summary.sport] || SPORT_EMOJI.unknown}
                </span>
                <span className="text-foreground capitalize">
                  {summary.sport} Analysis Complete
                </span>
              </h2>
              {summary.angle && summary.angle !== 'primary' && (
                <p className="mt-2 text-[14px] text-muted-foreground">
                  Analyzed perspective:{' '}
                  <span className="font-medium text-foreground capitalize">{summary.angle}</span>
                </p>
              )}
            </div>
            <div className="space-y-6 pt-6">
              <div className="grid md:grid-cols-2 gap-6 items-center bg-muted rounded-[6px] p-6 border border-border">
                <div className="text-center md:text-left">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground mb-2">
                    Total Form Score
                  </p>
                  <div className="flex items-baseline justify-center md:justify-start gap-1.5">
                    <div className={`text-[32px] font-semibold leading-none tabular-nums ${formScoreColor}`}>
                      {summary.form_score}
                    </div>
                    <span className="text-[15px] text-muted-foreground font-medium tabular-nums">
                      / 10
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2">
                    <StatusPill tone="gray">
                      <span className="capitalize">{summary.overall_rating} Level</span>
                    </StatusPill>
                    {summary.needs_review && <StatusPill tone="amber">Needs review</StatusPill>}
                  </div>
                  {summary.quality && !summary.quality.passed && (
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      Quality check: {summary.quality.issues.map(humanizeQualityIssue).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="text-center md:text-left border-l-0 md:border-l border-border md:pl-8">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground mb-3">
                    Overall Assessment
                  </p>
                  <p className="text-muted-foreground text-[14px] leading-[1.6]">{summary.summary}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-card rounded-[6px] p-6 border border-border">
                  <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground mb-4 flex items-center gap-2">
                    <svg
                      className="w-5 h-5 text-warning"
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
                        <span className="shrink-0 size-7 rounded-full bg-muted border border-border flex items-center justify-center text-[12px] font-medium tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="leading-relaxed text-[14px]">{tip}</span>
                      </li>
                    ))}
                  </ol>
                  {summary.priority_drill && (
                    <div className="mt-6 p-4 rounded-[6px] border border-border bg-muted">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.08em] mb-1">
                        Recommended Drill
                      </p>
                      <p className="text-[14px] text-foreground">{summary.priority_drill}</p>
                    </div>
                  )}
                </div>

                {summary.strengths && summary.strengths.length > 0 && (
                  <div className="bg-card rounded-[6px] p-6 border border-border flex flex-col justify-start">
                    <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground mb-4 flex items-center gap-2">
                      <svg
                        className="w-5 h-5 text-success"
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
                          <span className="text-success mt-1 shrink-0">•</span>
                          <span className="leading-relaxed text-[14px]">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          {summary.recommended_angles && summary.recommended_angles.length > 0 && (
            <div className="gsap-item mb-8 rounded-[6px] border border-border bg-card p-6">
              <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground mb-2 flex items-center gap-2">
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
                  <li key={angle.id} className="flex gap-3 text-[14px]">
                    <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 font-medium text-foreground capitalize h-fit">
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
                className="h-12 rounded-[6px] text-[14px] font-medium transition-colors active:scale-[0.98]"
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

            <Button
              nativeButton={false}
              render={<a href={downloadUrl} download="coachai_analysis.mp4" className="flex-1 block group" />}
              className="w-full h-12 rounded-[6px] text-[14px] font-medium transition-colors active:scale-[0.98]"
            >
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

            <Button
              variant="outline"
              className="h-12 rounded-[6px] text-[14px] font-medium transition-colors hover:bg-accent active:scale-[0.98]"
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
                className="group rounded-[6px] border border-border bg-card [&_summary::-webkit-details-marker]:hidden transition-colors open:bg-muted"
                open
              >
                <summary className="cursor-pointer p-6 flex flex-wrap items-center justify-between gap-4 select-none">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-[6px] bg-accent text-foreground">
                      <svg
                        className="w-5 h-5"
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
                      <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground leading-none">
                        Event Timeline
                      </h3>
                      <p className="text-muted-foreground text-[13px] mt-1.5">
                        <span className="tabular-nums">{summary.shot_events.length}</span> events
                        analyzed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium text-muted-foreground group-open:hidden">
                      Tap to view breakdown
                    </span>
                    <svg
                      className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform duration-200"
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
                    const toneClass =
                      event.form_score >= 8
                        ? 'bg-success/15 text-success'
                        : event.form_score >= 5
                          ? 'bg-warning/15 text-warning'
                          : 'bg-destructive/10 text-destructive'

                    return (
                      <div
                        key={index}
                        className="flex gap-5 p-5 rounded-[6px] border border-border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="shrink-0 flex flex-col items-center">
                          <TimestampPill seconds={event.timestamp ?? 0} />
                          {index !== summary.shot_events.length - 1 && (
                            <div className="w-px h-full bg-border my-3"></div>
                          )}
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                              {event.event_type?.replace('_', ' ') || 'Action'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass}`}
                            >
                              Score:{' '}
                              <span className="tabular-nums">
                                {event.form_score}/10
                              </span>
                            </span>
                          </div>
                          {event.key_observation && (
                            <p className="text-[14px] font-medium text-foreground mb-2 border-l-2 border-border pl-3">
                              {event.key_observation}
                            </p>
                          )}
                          <p className="text-muted-foreground text-[14px] leading-[1.55] pl-3">
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
