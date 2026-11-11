'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useReducedMotion } from 'motion/react'
import { Button } from '@/components/9ui/ui/button'
import { useAuthorizedMediaUrl } from '@/lib/useAuthorizedMediaUrl'
import FindingsTimeline from '@/components/FindingsTimeline'
import ProStatsPanel from '@/components/analysis/ProStatsPanel'
import TimestampPill from '@/components/TimestampPill'
import type { JobStatus } from '@/types'
import { SPORT_EMOJI } from '@/lib/sports'
import { summaryNumber } from '@/lib/analysis'
import {
  eventStateBadgeLabel,
  formatConfidencePercent,
  formatCoveragePercent,
  formatFormScore,
  getEventDetectionCounts,
} from '@/lib/analysisDisplay'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface ResultsSummaryProps {
  status: JobStatus
  jobId: string
  onReset: () => void
  onStartChat?: () => void
}

function formatMetric(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded}${unit}`
}

function trimScore(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
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
        duration: 0.3,
        stagger: 0.05,
        ease: 'power3.out',
      })
    },
    { scope: containerRef },
  )

  if (!summary) {
    return (
      <div className="rounded-[6px] border border-border bg-card p-8 text-center text-muted-foreground">
        No analysis summary available.
      </div>
    )
  }

  const formScore = summaryNumber(summary, 'form_score')
  const scorePercent = formScore !== null ? Math.min(100, Math.max(0, formScore * 10)) : null
  // The composite is experimental. There is deliberately no fallback label: an
  // unavailable score must read as unavailable, never as "Good".
  const rating = summary.overall_rating
  const composite = summary.composite
  const compositeCoverage = composite?.coverage
  const sport = summary.sport || 'General'
  const sessionMetrics = Array.isArray(summary.session_metrics) ? summary.session_metrics : []
  const eventCounts = getEventDetectionCounts({ summary_json: summary })
  const confirmedEvents = eventCounts.confirmed
  const candidateEvents = eventCounts.candidate
  const uncertainEvents = eventCounts.uncertain
  const focusAreas = Array.isArray(summary.top_tips) ? summary.top_tips.filter(Boolean) : []
  const strengths = Array.isArray(summary.strengths) ? summary.strengths.filter(Boolean) : []
  const narrative = typeof summary.summary === 'string' ? summary.summary.trim() : ''
  const needsReview = Boolean(summary.needs_review || summary.quality?.needs_review)
  const qualityIssues = Array.isArray(summary.quality?.issues) ? summary.quality?.issues : []
  const failures = Array.isArray(summary.failures) ? summary.failures : []
  const failureNotes = failures
    .map((f) => {
      const detail = f?.detail as Record<string, unknown> | null | undefined
      const unseen = Array.isArray(detail?.unseen_candidates)
        ? (detail?.unseen_candidates as unknown[]).length
        : null
      if (f.code === 'F07_MISSED_CANDIDATE' && unseen) {
        return `${unseen} candidate moment${unseen === 1 ? '' : 's'} not shown for model review`
      }
      return typeof f.message === 'string' && f.message ? f.message : f.code
    })
    .filter(Boolean)
  const shotEvents = Array.isArray(summary.shot_events) ? summary.shot_events : []
  const findings = Array.isArray(summary.findings) ? summary.findings : []

  const scoreTone =
    formScore === null
      ? 'text-muted-foreground'
      : formScore >= 8
        ? 'text-success'
        : formScore >= 5
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
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-title font-semibold tracking-[-0.02em] text-foreground capitalize">
                    {sport} Analysis
                  </h1>
                  <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
                    Experimental score
                  </span>
                  {rating && (
                    <span className="rounded-[4px] border border-border bg-accent/50 px-2 py-0.5 text-meta font-medium capitalize text-muted-foreground">
                      {rating}
                    </span>
                  )}
                  {needsReview && (
                    <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
                      Needs review
                    </span>
                  )}
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

        {narrative ? (
          <div className="gsap-item rounded-[6px] border border-border bg-card p-6">
            <h2 className="text-lead font-semibold tracking-[-0.01em] text-foreground mb-2">
              Session summary
            </h2>
            <p className="text-body leading-[1.7] text-foreground">{narrative}</p>
            {qualityIssues.length > 0 && (
              <p className="mt-3 text-meta text-muted-foreground">
                Quality notes: {qualityIssues.join('; ')}
              </p>
            )}
            {failureNotes.length > 0 && (
              <p className="mt-2 text-meta text-muted-foreground">
                {failureNotes.slice(0, 2).join(' · ')}
              </p>
            )}
          </div>
        ) : qualityIssues.length > 0 || failureNotes.length > 0 ? (
          <div className="gsap-item rounded-[6px] border border-border bg-card p-6">
            {qualityIssues.length > 0 && (
              <p className="text-meta text-muted-foreground">
                Quality notes: {qualityIssues.join('; ')}
              </p>
            )}
            {failureNotes.length > 0 && (
              <p className={`${qualityIssues.length > 0 ? 'mt-2 ' : ''}text-meta text-muted-foreground`}>
                {failureNotes.slice(0, 2).join(' · ')}
              </p>
            )}
          </div>
        ) : null}

        {/* Main Grid: Score Card + Key Insights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Form Score Card */}
          <div className="gsap-item md:col-span-1 rounded-[6px] border border-border bg-card p-6 flex flex-col justify-between relative overflow-hidden">
            <div>
              <p className="text-muted-foreground text-meta font-medium uppercase tracking-[0.08em]">
                Experimental Form Score
              </p>
              <div className="flex items-baseline gap-2 mt-4">
                <span
                  className={`text-6xl font-bold tracking-tight ${scoreTone} font-mono tabular-nums`}
                  aria-label={`Experimental form score ${formatFormScore(formScore)}`}
                >
                  {formScore !== null ? trimScore(formScore) : '—'}
                </span>
                <span className="text-muted-foreground text-body font-mono">/10</span>
              </div>
              <p className="mt-2 text-meta text-muted-foreground">
                {formScore !== null
                  ? `Weighted ideal-range composite across ${formatCoveragePercent(compositeCoverage)} measured coverage${
                      typeof composite?.scored_events === 'number' &&
                      typeof composite?.considered_events === 'number'
                        ? ` (${composite.scored_events} scored / ${composite.considered_events} considered events)`
                        : ''
                    }.`
                  : 'Not available — too few criteria could be measured from this camera angle.'}
              </p>
              {typeof summary.confidence === 'number' && (
                <p className="mt-2 text-meta text-muted-foreground">
                  {summary.confidence_kind === 'tracking' || summary.confidence_kind === 'pose'
                    ? 'Tracking confidence'
                    : 'Event confidence'}{' '}
                  {formatConfidencePercent(summary.confidence)}
                  {typeof summary.pose_confidence === 'number' &&
                  summary.confidence_kind !== 'tracking' &&
                  summary.confidence_kind !== 'pose' &&
                  Math.abs(summary.pose_confidence - summary.confidence) > 0.01
                    ? ` · pose ${formatConfidencePercent(summary.pose_confidence)}`
                    : ''}
                </p>
              )}
            </div>

            {/* Score Visual Bar */}
            <div className="my-6">
              <div className="h-2 w-full bg-accent rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    formScore !== null && formScore >= 8
                      ? 'bg-success'
                      : formScore !== null && formScore >= 5
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
              <p className="text-muted-foreground text-meta">Experimental rating</p>
              <p className="text-body font-semibold text-foreground capitalize mt-0.5">
                {rating ? `${rating} execution` : 'Not available'}
              </p>
              <p className="mt-3 rounded-[4px] border border-warning/30 bg-warning/10 px-3 py-2 text-meta leading-snug text-muted-foreground">
                Provisional, unvalidated weighting. This is not an independently validated measure
                of athletic performance and must not be used for coaching or selection decisions.
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
                  {strengths.length > 0 ? (
                    <ul className="text-body text-muted-foreground space-y-1.5 list-disc list-inside">
                      {strengths.slice(0, 3).map((s, idx) => (
                        <li key={idx} className="leading-snug">
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">
                      Not enough measured evidence to highlight strengths yet.
                    </p>
                  )}
                </div>

                {/* Focus areas */}
                <div className="rounded-[6px] border border-warning/20 bg-warning/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-warning text-body">→</span>
                    <h3 className="text-body font-semibold text-foreground">Focus Areas</h3>
                  </div>
                  {focusAreas.length > 0 ? (
                    <ul className="text-body text-muted-foreground space-y-1.5 list-disc list-inside">
                      {focusAreas.slice(0, 3).map((s, idx) => (
                        <li key={idx} className="leading-snug">
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body text-muted-foreground">
                      No specific focus areas were produced for this clip.
                    </p>
                  )}
                </div>
              </div>
              {summary.priority_drill ? (
                <div className="mt-4 rounded-[6px] border border-border bg-background p-4">
                  <p className="text-meta font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Priority drill
                  </p>
                  <p className="mt-1 text-body text-foreground">{summary.priority_drill}</p>
                </div>
              ) : null}
            </div>

            {/* Bottom Actions Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 mt-4">
              <span className="text-meta text-muted-foreground">
                <span className="tabular-nums">{confirmedEvents ?? '—'}</span> confirmed events
                {candidateEvents > 0 ? (
                  <>
                    {' '}
                    · <span className="tabular-nums">{candidateEvents}</span> unconfirmed candidate{candidateEvents === 1 ? '' : 's'}
                  </>
                ) : null}
                {uncertainEvents > 0 ? (
                  <>
                    {' '}
                    · <span className="tabular-nums">{uncertainEvents}</span> uncertain
                  </>
                ) : null}
              </span>
              {status.video_ready ? (
                <a
                  href={downloadUrl}
                  download={`coachxyz-${jobId}.mp4`}
                  className="text-body font-medium text-primary hover:text-primary-hover flex items-center gap-1.5"
                >
                  <span>Download Annotated Video</span>
                  <span>↓</span>
                </a>
              ) : (
                <span className="text-meta text-muted-foreground">
                  Annotated video is not available for this run.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Measured performance */}
        {sessionMetrics.length > 0 && (
          <div className="gsap-item rounded-[6px] border border-border bg-card p-6">
            <h2 className="text-lead font-semibold tracking-[-0.01em] text-foreground mb-1">
              Measured Performance
            </h2>
            <p className="text-muted-foreground text-meta mb-4">
              Numbers measured from the athlete's pose, normalised so camera distance does not
              change the reading.
            </p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {sessionMetrics.map((metric) => (
                <div
                  key={metric.key}
                  className="rounded-[6px] border border-border bg-background px-4 py-3"
                >
                  <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-1 font-semibold text-[24px] leading-none tabular-nums text-foreground">
                    {formatMetric(metric.value, metric.unit)}
                  </p>
                  {typeof metric.best === 'number' && (
                    <p className="mt-1 text-meta text-muted-foreground">
                      best {formatMetric(metric.best, metric.unit)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Professional stat layer: provenance-labelled groups + honest gaps */}
        {(Boolean(summary.stats) ||
          Boolean(summary.tactical_summary) ||
          Boolean(summary.key_insights?.length)) && (
          <div className="gsap-item">
            <ProStatsPanel
              stats={summary.stats}
              tacticalSummary={summary.tactical_summary}
              keyInsights={summary.key_insights}
            />
          </div>
        )}

        {/* Detailed Findings Timeline Component */}
        <div className="gsap-item">
          <FindingsTimeline findings={findings} />
        </div>

        {/* Event Breakdown - Collapsible */}
        <div className="gsap-item">
          {shotEvents.length > 0 ? (
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
                        <span className="tabular-nums">{shotEvents.length}</span> timeline events
                        {confirmedEvents !== null ? (
                          <>
                            {' '}
                            · <span className="tabular-nums">{confirmedEvents}</span> confirmed events
                          </>
                        ) : null}
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
                  {shotEvents.map((event, index) => {
                    const eventScore = typeof event.form_score === 'number' ? event.form_score : null
                    const toneClass =
                      eventScore === null
                        ? 'bg-accent text-muted-foreground'
                        : eventScore >= 8
                          ? 'bg-success/15 text-success'
                          : eventScore >= 5
                            ? 'bg-warning/15 text-warning'
                            : 'bg-destructive/10 text-destructive'

                    return (
                      <div
                        key={index}
                        className="flex gap-5 p-5 rounded-[6px] border border-border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="shrink-0 flex flex-col items-center">
                          <TimestampPill seconds={event.timestamp ?? 0} />
                          {index !== shotEvents.length - 1 && (
                            <div className="w-px h-full bg-border my-3"></div>
                          )}
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                            <span className="rounded-full bg-accent px-2 py-0.5 text-label font-medium capitalize text-muted-foreground">
                              {event.event_type?.replace('_', ' ') || 'Action'}
                            </span>
                            {eventStateBadgeLabel(event.event_state) ? (
                              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-label font-medium text-warning">
                                {eventStateBadgeLabel(event.event_state)}
                              </span>
                            ) : null}
                            <span
                              className={`rounded-full px-2 py-0.5 text-label font-medium ${toneClass}`}
                            >
                              Score:{' '}
                              <span className="tabular-nums">{formatFormScore(eventScore)}</span>
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
                          {event.metrics && event.metrics.length > 0 && !(event.matchup?.primary?.metrics?.length) && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-3">
                              {event.metrics
                                .filter((metric) => typeof metric.value === 'number')
                                .slice(0, 3)
                                .map((metric) => (
                                  <span
                                    key={metric.key}
                                    className="text-label text-muted-foreground"
                                  >
                                    {metric.label}{' '}
                                    <span className="tabular-nums text-foreground">
                                      {formatMetric(metric.value as number, metric.unit)}
                                    </span>
                                  </span>
                                ))}
                            </div>
                          )}
                          {event.matchup && (
                            <div className="mt-3 rounded-[6px] border border-border bg-background p-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                {[
                                  { key: 'primary', role: event.matchup.primary },
                                  { key: 'opponent', role: event.matchup.opponent },
                                ].map(({ key, role }) =>
                                  role ? (
                                    <div key={key}>
                                      <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                        {role.role}
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                        {(role.metrics ?? [])
                                          .filter((metric) => typeof metric.value === 'number')
                                          .slice(0, 3)
                                          .map((metric) => (
                                            <span
                                              key={metric.key}
                                              className="text-label text-muted-foreground"
                                            >
                                              {metric.label}{' '}
                                              <span className="tabular-nums text-foreground">
                                                {formatMetric(metric.value as number, metric.unit)}
                                              </span>
                                            </span>
                                          ))}
                                      </div>
                                    </div>
                                  ) : null,
                                )}
                              </div>
                              {typeof event.matchup.separation?.distance === 'number' && (
                                <p className="mt-2 text-label text-muted-foreground">
                                  Distance to {event.matchup.roles.opponent.toLowerCase()}:{' '}
                                  <span className="tabular-nums text-foreground">
                                    {event.matchup.separation.distance.toFixed(1)} torso
                                  </span>
                                </p>
                              )}
                              {event.matchup.primary?.tracked === false && (
                                <p className="mt-2 text-label text-muted-foreground">
                                  Primary-player tracking was not confirmed for this matchup.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
