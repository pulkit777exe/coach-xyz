'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useReducedMotion } from 'motion/react'
import { Button } from '@/components/9ui/ui/button'
import StatusPill from '@/components/org/StatusPill'
import { useAuthorizedMediaUrl } from '@/lib/useAuthorizedMediaUrl'
import FindingsTimeline from '@/components/FindingsTimeline'
import TimestampPill from '@/components/TimestampPill'
import type { JobStatus } from '@/types'
import { SPORT_EMOJI } from '@/lib/sports'
import { summaryNumber } from '@/lib/analysis'

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
  const reducedMotion = useReducedMotion()
  const downloadUrl = useAuthorizedMediaUrl(jobId)

  useGSAP(
    () => {
      // Respect the OS "reduce motion" setting. This is the ONLY animation on the
      // results view, and it moved six sections 24px while fading them in — which a
      // user with vestibular sensitivity cannot opt out of, because nothing here
      // consulted their preference. Three files in this app honour the setting
      // (`interior/progress-bar`, `TypewriterHighlight`, the `globals.css` block);
      // this was the one conspicuous place that did not.
      //
      // Skipping rather than shortening: `components/interior/progress-bar.tsx`
      // reduces to `duration: 0`, and a 0s tween still lands the elements in their
      // final state, which is the correct outcome for a reveal that exists only to
      // decorate. `dependencies` is deliberately left off so the animation still
      // runs exactly once on mount — adding `reduced` there would replay the whole
      // reveal every time `summary` changed.
      if (!summary || reducedMotion) return
      gsap.from('.gsap-item', {
        y: 24,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power3.out',
      })
    },
    { scope: containerRef },
  )

  if (!summary) {
    return (
      <div className="rounded-[6px] border border-border bg-card p-8 text-center text-muted-foreground">
        No summary data available.
      </div>
    )
  }

  const score = summaryNumber(summary.form_score)
  const scorePercent = score !== null ? Math.min(100, Math.max(0, score * 10)) : null
  const rating = summary.overall_rating || 'Good'
  const sport = summary.sport || 'General'

  const scoreTone =
    score !== null && score >= 8
      ? 'text-success'
      : score !== null && score >= 5
        ? 'text-warning'
        : 'text-destructive'

  return (
    <>
      <div ref={containerRef} className="max-w-4xl mx-auto space-y-6 pt-2 pb-16">
        {/* Top Header Section */}
        <div className="gsap-item flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{SPORT_EMOJI[sport.toLowerCase()] || '🎯'}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-title font-semibold tracking-[-0.02em] text-foreground capitalize">
                    {sport} Analysis
                  </h1>
                  <span className="rounded-[4px] border border-border bg-accent/50 px-2 py-0.5 text-meta font-medium capitalize text-muted-foreground">
                    {rating}
                  </span>
                </div>
                <p className="text-muted-foreground text-body">
                  AI-powered form feedback & biomechanics assessment
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {onStartChat && (
              <Button onClick={onStartChat}>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                Ask AI Coach
              </Button>
            )}
            <Button variant="outline" onClick={onReset}>
              Analyze Another
            </Button>
          </div>
        </div>

        {/* Quality issues banner (derived by the engine quality policy) */}
        {status.quality_issues && status.quality_issues.length > 0 && (
          <div className="gsap-item rounded-[6px] border border-warning/30 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-lg">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-foreground">
                  Quality checks flagged this analysis
                </p>
                <p className="text-muted-foreground text-meta mt-0.5">
                  Some metrics or timestamps may be approximate:
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {status.quality_issues.map((issue) => (
                    <StatusPill key={issue} tone="amber">
                      {humanizeQualityIssue(issue)}
                    </StatusPill>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Grid: Score Card + Key Insights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Form Score Card */}
          <div className="gsap-item md:col-span-1 rounded-[6px] border border-border bg-card p-6 flex flex-col justify-between relative overflow-hidden">
            <div>
              <p className="text-muted-foreground text-meta font-medium uppercase tracking-[0.08em]">
                Overall Form Score
              </p>
              <div className="flex items-baseline gap-2 mt-4">
                <span
                  className={`text-6xl font-bold tracking-tight ${scoreTone} font-mono tabular-nums`}
                >
                  {score !== null ? score : '—'}
                </span>
                <span className="text-muted-foreground text-body font-mono">/10</span>
              </div>
            </div>

            {/* Score Visual Bar */}
            <div className="my-6">
              <div className="h-2 w-full bg-accent rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    score !== null && score >= 8
                      ? 'bg-success'
                      : score !== null && score >= 5
                        ? 'bg-warning'
                        : 'bg-destructive'
                  }`}
                  style={{ width: `${scorePercent !== null ? scorePercent : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-label text-muted-foreground mt-2 font-mono tabular-nums">
                <span>0</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-muted-foreground text-meta">Performance Rating</p>
              <p className="text-body font-semibold text-foreground capitalize mt-0.5">
                {rating} Execution
              </p>
            </div>
          </div>

          {/* Key Insights / Quick Summary */}
          <div className="gsap-item md:col-span-2 rounded-[6px] border border-border bg-card p-6 flex flex-col justify-between">
            <div>
              <h2 className="text-lead font-semibold tracking-[-0.01em] text-foreground mb-4">
                Key Strengths & Focus Areas
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Strengths */}
                <div className="rounded-[6px] border border-success/20 bg-success/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-success text-body">✓</span>
                    <h3 className="text-body font-semibold text-foreground">Top Strengths</h3>
                  </div>
                  {summary.strengths && summary.strengths.length > 0 ? (
                    <ul className="text-body text-muted-foreground space-y-1.5 list-disc list-inside">
                      {summary.strengths.slice(0, 3).map((s, idx) => (
                        <li key={idx} className="leading-snug">
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">Solid baseline mechanics.</p>
                  )}
                </div>

                {/* Areas for Improvement */}
                <div className="rounded-[6px] border border-warning/20 bg-warning/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-warning text-body">!</span>
                    <h3 className="text-body font-semibold text-foreground">Areas to Improve</h3>
                  </div>
                  {summary.improvements && summary.improvements.length > 0 ? (
                    <ul className="text-body text-muted-foreground space-y-1.5 list-disc list-inside">
                      {summary.improvements.slice(0, 3).map((imp, idx) => (
                        <li key={idx} className="leading-snug">
                          {imp}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">No critical flaws detected.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
              <span className="text-meta text-muted-foreground">
                <span className="tabular-nums">{summary.shot_events?.length || 0}</span> events
                captured
              </span>
              <a
                href={downloadUrl}
                download={`coachxyz-${jobId}.mp4`}
                className="text-body font-medium text-primary hover:text-primary-hover flex items-center gap-1.5"
              >
                <span>Download Annotated Video</span>
                <span>↓</span>
              </a>
            </div>
          </div>
        </div>

        {/* Cues / Corrections */}
        {summary.corrections && summary.corrections.length > 0 && (
          <div className="gsap-item rounded-[6px] border border-border bg-card p-6">
            <h2 className="text-lead font-semibold tracking-[-0.01em] text-foreground mb-4">
              Recommended Corrections
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {summary.corrections.map((corr, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3.5 rounded-[6px] border border-border bg-card hover:bg-accent/50 transition-colors"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-meta font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-body text-foreground leading-[1.55]">{corr}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Findings Timeline Component */}
        <div className="gsap-item">
          <FindingsTimeline findings={summary.findings || []} shotEvents={summary.shot_events} />
        </div>

        {/* Event Breakdown - Collapsible */}
        <div className="gsap-item">
          {summary.shot_events && summary.shot_events.length > 0 && (
            <div className="rounded-[6px] border border-border bg-card overflow-hidden">
              <details className="group">
                <summary className="flex items-center justify-between p-6 cursor-pointer hover:bg-accent/50 transition-colors list-none">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📊</span>
                    <div>
                      <h3 className="text-lead font-semibold tracking-[-0.01em] text-foreground leading-none">
                        Event Timeline
                      </h3>
                      <p className="text-muted-foreground text-meta mt-1.5">
                        <span className="tabular-nums">{summary.shot_events.length}</span> events
                        analyzed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-meta font-medium text-muted-foreground group-open:hidden">
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
                            <span className="rounded-full bg-accent px-2 py-0.5 text-label font-medium capitalize text-muted-foreground">
                              {event.event_type?.replace('_', ' ') || 'Action'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-label font-medium ${toneClass}`}
                            >
                              Score: <span className="tabular-nums">{event.form_score}/10</span>
                            </span>
                          </div>
                          {event.key_observation && (
                            <p className="text-body font-medium text-foreground mb-2 border-l-2 border-border pl-3">
                              {event.key_observation}
                            </p>
                          )}
                          <p className="text-muted-foreground text-body leading-[1.55] pl-3">
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
