import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { ClockIcon, LinkIcon } from 'lucide-react'
import { resolveShareToken } from '@/lib/aiReports'
import type { SharedAnalysis } from '@/lib/aiReports'
import type { CoachAIError } from '@/types'
import { formatDateLong } from '@/lib/date'
import { summaryNumber } from '@/lib/analysis'
import {
  eventStateBadgeLabel,
  formatConfidencePercent,
  formatFormScore,
  getEventDetectionCounts,
} from '@/lib/analysisDisplay'

// Public share page for players/coaches who receive a share link. No login is
// required: the backend resolves the token out-of-band and returns a read-only
// slice of the analysis. Lives under /share/<token> (outside the coach-only
// dashboard layout).

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  try {
    const res = await resolveShareToken(token)
    const label = res.analysis.display_name || res.server_job_id.slice(0, 8)
    return {
      title: `${label} | CoachXYZ`,
      description: 'Shared analysis from CoachXYZ.',
    }
  } catch {
    return { title: 'Shared analysis | CoachXYZ' }
  }
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  noStore()
  const { token } = await params

  let data: SharedAnalysis | null = null
  let problem: { expired: boolean; message: string } | null = null
  try {
    data = await resolveShareToken(token)
  } catch (err) {
    const e = err as CoachAIError
    problem = {
      expired: e.code === 'SHARE_EXPIRED',
      message: e.message ?? 'This share link is no longer available.',
    }
  }

  if (problem || !data) {
    return (
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center"
      >
        <div className="border-border bg-card w-full rounded-[6px] border p-10">
          <div className="text-muted-foreground mx-auto mb-4 flex size-14 items-center justify-center rounded-full border border-border">
            {problem?.expired ? <ClockIcon className="size-6" /> : <LinkIcon className="size-6" />}
          </div>
          <h1 className="text-foreground mt-4 text-[26px] font-bold tracking-[-0.015em]">
            {problem?.expired ? 'Share link expired' : 'Link not found'}
          </h1>
          <p className="text-muted-foreground mt-2 text-body">{problem?.message}</p>
          <p className="text-muted-foreground mt-1 text-meta">
            Ask the coach who shared it to create a new link.
          </p>
        </div>
      </main>
    )
  }

  const summary = toRecord(data.analysis.summary_json)
  const shotEvents = summary && isEvents(summary.shot_events) ? summary.shot_events : []
  const tips = summary ? strArray(summary.top_tips) : []
  const strengths = summary ? strArray(summary.strengths) : []
  const narrative = summary ? str(summary.summary) : null
  const tactical = summary ? str(summary.tactical_summary) : null
  const needsReview = summary
    ? Boolean(summary.needs_review || toRecord(summary.quality)?.needs_review)
    : false
  const qualityIssues = summary ? strArray(toRecord(summary.quality)?.issues) : []
  const failures = summary && Array.isArray(summary.failures) ? (summary.failures as Array<Record<string, unknown>>) : []
  const failureNotes = failures
    .map((f) => {
      const detail = toRecord(f.detail)
      const unseen = Array.isArray(detail?.unseen_candidates) ? detail.unseen_candidates.length : null
      if (f.code === 'F07_MISSED_CANDIDATE' && unseen) {
        return `${unseen} candidate moment${unseen === 1 ? '' : 's'} not shown for model review`
      }
      return str(f.message) ?? str(f.code) ?? ''
    })
    .filter(Boolean)
  const confidenceKind = summary ? str(summary.confidence_kind) : null
  const poseConfidence = summary ? num(summary.pose_confidence) : null
  const confidence = summary ? summaryNumber(summary, 'confidence') : null
  const confidenceDetail =
    confidence !== null
      ? `${confidenceKind === 'tracking' || confidenceKind === 'pose' ? 'Tracking confidence' : 'Event confidence'} ${formatConfidencePercent(confidence)}${
          poseConfidence !== null &&
          confidenceKind !== 'tracking' &&
          confidenceKind !== 'pose' &&
          Math.abs(poseConfidence - confidence) > 0.01
            ? ` · pose ${formatConfidencePercent(poseConfidence)}`
            : ''
        }`
      : null
  const composite = summary ? toRecord(summary.composite) : null
  const compositeScored = composite ? num(composite.scored_events) : null
  const compositeConsidered = composite ? num(composite.considered_events) : null
  const eventCounts = getEventDetectionCounts({ summary_json: summary })
  const confirmedEvents = eventCounts.confirmed
  const candidateEvents = eventCounts.candidate
  const uncertainEvents = eventCounts.uncertain
  const label = data.analysis.display_name || data.server_job_id.slice(0, 8)

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      {/* Header */}
      <div className="mb-10">
        <p className="text-muted-foreground mb-3 text-label font-medium uppercase tracking-[0.08em]">
          Shared Analysis
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-[30px] font-bold tracking-[-0.015em]">{label}</h1>
          {needsReview ? (
            <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
              Needs review
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-2 flex items-center gap-3 text-meta tabular-nums">
          <span>{formatDateLong(data.analysis.requested_at)}</span>
          {data.analysis.model && <span>{data.analysis.model}</span>}
        </div>
      </div>

      {/* Stats */}
      {summary ? (
        <div className="mb-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              {
                label: 'Experimental Score',
                value: formatFormScore(summaryNumber(summary, 'form_score')),
                note:
                  compositeScored !== null && compositeConsidered !== null
                    ? `${compositeScored} scored / ${compositeConsidered} considered`
                    : null,
              },
              { label: 'Confidence', value: formatConfidencePercent(summaryNumber(summary, 'confidence')), note: confidenceDetail },
              { label: 'Confirmed Events', value: confirmedEvents === null ? '—' : String(confirmedEvents), note: null },
              {
                label: 'Video',
                value: data.analysis.video_ready ? 'Available' : 'Not available',
                note: null,
              },
            ].map((card) => (
              <div key={card.label} className="border-border bg-card rounded-[6px] border p-5">
                <p className="text-muted-foreground text-label font-medium uppercase tracking-[0.08em]">
                  {card.label}
                </p>
                <p className="text-foreground mt-2 text-[28px] font-semibold leading-none tabular-nums">
                  {card.value}
                </p>
                {card.note ? <p className="mt-1 text-label text-muted-foreground">{card.note}</p> : null}
              </div>
            ))}
          </div>
          {candidateEvents > 0 || uncertainEvents > 0 ? (
            <p className="text-muted-foreground mt-3 text-meta">
              {candidateEvents > 0 ? (
                <>
                  <span className="tabular-nums">{candidateEvents}</span> unconfirmed candidate
                  {candidateEvents === 1 ? '' : 's'}
                </>
              ) : null}
              {candidateEvents > 0 && uncertainEvents > 0 ? ' · ' : null}
              {uncertainEvents > 0 ? (
                <>
                  <span className="tabular-nums">{uncertainEvents}</span> uncertain
                </>
              ) : null}
              {' '}not included in confirmed performance counts.
            </p>
          ) : null}
        </div>
      ) : null}

      {(narrative || tactical) && (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Session summary</p>
          </div>
          <div className="space-y-3 p-5 text-body leading-[1.7] text-foreground">
            {narrative ? <p>{narrative}</p> : null}
            {tactical && tactical !== narrative ? <p>{tactical}</p> : null}
            {qualityIssues.length > 0 ? (
              <p className="text-meta text-muted-foreground">Quality notes: {qualityIssues.join('; ')}</p>
            ) : null}
            {failureNotes.length > 0 ? (
              <p className="text-meta text-muted-foreground">{failureNotes.slice(0, 2).join(' · ')}</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Tips, strengths, drill */}
      {summary && (tips.length > 0 || strengths.length > 0) && (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {tips.length > 0 && (
            <div className="border-border bg-card rounded-[6px] border">
              <div className="border-b border-border px-5 py-3.5">
                <p className="text-lead font-semibold text-foreground">Priority Focus</p>
              </div>
              <ul className="space-y-2 p-5">
                {tips.map((tip, i) => (
                  <li key={i} className="text-foreground flex items-start gap-2 text-body">
                    <span className="text-muted-foreground shrink-0 tabular-nums">{i + 1}.</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {strengths.length > 0 && (
            <div className="border-border bg-card rounded-[6px] border">
              <div className="border-b border-border px-5 py-3.5">
                <p className="text-lead font-semibold text-foreground">Strengths</p>
              </div>
              <ul className="space-y-2 p-5">
                {strengths.map((s, i) => (
                  <li key={i} className="text-foreground flex items-start gap-2 text-body">
                    <span className="text-success shrink-0">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {summary && str(summary.priority_drill) && (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Recommended Drill</p>
          </div>
          <p className="text-foreground p-5 text-body">{str(summary.priority_drill)}</p>
        </div>
      )}

      {/* Shot events */}
      {shotEvents.length > 0 ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Key moments</p>
            <p className="text-muted-foreground mt-1 text-meta">
              Timeline includes unconfirmed candidates; only confirmed events count as performance.
            </p>
          </div>
          <ul className="p-5 pt-4">
            {shotEvents.slice(0, 10).map((event, i) => (
              <li
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < Math.min(10, shotEvents.length) - 1 ? 'border-border border-b' : ''
                }`}
              >
                {typeof event.timestamp === 'number' && (
                  <span className="text-muted-foreground font-mono text-meta tabular-nums w-16 shrink-0">
                    {mmss(event.timestamp)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-foreground text-body">{str(event.event_type) ?? 'Event'}</p>
                    {eventStateBadgeLabel(event.event_state) && (
                      <span className="rounded-full bg-warning/15 px-2 text-label font-medium leading-[18px] text-warning">
                        {eventStateBadgeLabel(event.event_state)}
                      </span>
                    )}
                    {typeof event.form_score === 'number' && Number.isFinite(event.form_score) ? (
                      <span
                        className={`rounded-full px-2 text-label font-medium leading-[18px] tabular-nums ${
                          event.form_score >= 8
                            ? 'text-success bg-success/15'
                            : event.form_score >= 5
                              ? 'text-warning bg-warning/15'
                              : 'text-destructive bg-destructive/10'
                        }`}
                      >
                        {formatFormScore(event.form_score)}
                      </span>
                    ) : event.form_score === null ? (
                      <span className="rounded-full bg-accent px-2 text-label font-medium leading-[18px] text-muted-foreground">
                        Score: —
                      </span>
                    ) : null}
                  </div>
                  {str(event.feedback) && (
                    <p className="text-muted-foreground mt-1 text-meta">{str(event.feedback)}</p>
                  )}
                  {str(event.key_observation) && (
                    <p className="text-muted-foreground mt-0.5 text-meta">
                      {str(event.key_observation)}
                    </p>
                  )}
                  {toRecord(event.matchup)?.primary && (toRecord(toRecord(event.matchup)?.primary)?.tracked === false) ? (
                    <p className="text-muted-foreground mt-1 text-meta">
                      Primary athlete not reliably tracked for this matchup; values may be limited.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : summary ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border p-5">
          <p className="text-muted-foreground text-body">No key moments were detected in this clip.</p>
        </div>
      ) : null}

      {summary && (qualityIssues.length > 0 || failureNotes.length > 0) && !(narrative || tactical) ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border p-5 space-y-1">
          {qualityIssues.length > 0 ? (
            <p className="text-meta text-muted-foreground">Quality notes: {qualityIssues.join('; ')}</p>
          ) : null}
          {failureNotes.length > 0 ? (
            <p className="text-meta text-muted-foreground">{failureNotes.slice(0, 2).join(' · ')}</p>
          ) : null}
        </div>
      ) : null}

      {!summary ? (
        <div className="border-border bg-card rounded-[6px] border p-6 text-body">
          <p className="text-muted-foreground">This analysis has no summary to display.</p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-center text-meta tabular-nums">
        Shared via CoachXYZ · expires {formatDateLong(data.expires_at)}
      </p>
    </main>
  )
}

// ── Local helpers ────────────────────────────────────────────────────────────

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

// formatting/count helpers live in `@/lib/analysisDisplay` for cross-surface consistency.

function isEvents(v: unknown): v is Array<{
  timestamp?: unknown
  event_type?: unknown
  form_score?: unknown
  event_state?: unknown
  feedback?: unknown
  key_observation?: unknown
  matchup?: unknown
}> {
  return Array.isArray(v)
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = String(Math.round(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}
