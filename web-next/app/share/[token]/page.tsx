import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { ClockIcon, LinkIcon } from 'lucide-react'
import { resolveShareToken } from '@/lib/aiReports'
import type { SharedAnalysis } from '@/lib/aiReports'
import FindingsTimeline from '@/components/FindingsTimeline'
import ProStatsPanel from '@/components/analysis/ProStatsPanel'
import type { CoachAIError, Finding, ProfessionalStats } from '@/types'
import { formatDateLong } from '@/lib/date'
import { summaryNumber } from '@/lib/analysis'
import {
  eventStateBadgeLabel,
  formatConfidencePercent,
  formatCoveragePercent,
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
  const findings = summary && Array.isArray(summary.findings) ? (summary.findings as Finding[]) : []
  const shotEvents = summary && isEvents(summary.shot_events) ? summary.shot_events : []
  const tips = summary ? strArray(summary.top_tips) : []
  const strengths = summary ? strArray(summary.strengths) : []
  const keyInsights = summary ? strArray(summary.key_insights) : []
  const narrative = summary ? str(summary.summary) : null
  const tactical = summary ? str(summary.tactical_summary) : null
  const scopeNote = summary ? str(summary.scope_note) : null
  const needsReview = summary
    ? Boolean(summary.needs_review || toRecord(summary.quality)?.needs_review)
    : false
  const qualityIssues = summary ? strArray(toRecord(summary.quality)?.issues) : []
  const failures = summary && Array.isArray(summary.failures) ? (summary.failures as Array<Record<string, unknown>>) : []
  const failureDetails = failures.map(describeFailure).filter(Boolean)
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
  const compositeContext = composite
    ? [
        num(composite.scored_events) !== null && num(composite.considered_events) !== null
          ? `${num(composite.scored_events)} scored / ${num(composite.considered_events)} considered`
          : null,
        num(composite.coverage) !== null ? `coverage ${formatCoveragePercent(num(composite.coverage))}` : null,
        num(composite.minimum_coverage) !== null
          ? `minimum ${formatCoveragePercent(num(composite.minimum_coverage))}`
          : null,
        str(composite.method) ? `method ${str(composite.method)}` : null,
        str(composite.status) ? `status ${str(composite.status)}` : null,
        str(composite.reason) ? `reason: ${str(composite.reason)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const eventDetection = summary ? toRecord(summary.event_detection) : null
  const eventDetectionSummary = eventDetection
    ? [
        str(eventDetection.method) ? `method ${str(eventDetection.method)}` : null,
        str(eventDetection.validation_status) ? `validation ${str(eventDetection.validation_status)}` : null,
        num(eventDetection.rejected) !== null ? `rejected ${num(eventDetection.rejected)}` : null,
        str(eventDetection.note) ? str(eventDetection.note) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const eventCounts = getEventDetectionCounts({ summary_json: summary })
  const confirmedEvents = eventCounts.confirmed
  const candidateEvents = eventCounts.candidate
  const uncertainEvents = eventCounts.uncertain
  const sessionMetrics = summary && Array.isArray(summary.session_metrics)
    ? (summary.session_metrics as Array<Record<string, unknown>>).filter(
        (m) => typeof m.value === 'number' && Number.isFinite(m.value),
      )
    : []
  const proStats =
    summary?.stats && typeof summary.stats === 'object' && !Array.isArray(summary.stats)
      ? (summary.stats as ProfessionalStats)
      : null
  const angle = summary ? str(summary.angle) : null
  const angleSource = summary ? str(summary.angle_source) : null
  const recommendedAngles = summary && Array.isArray(summary.recommended_angles)
    ? (summary.recommended_angles as Array<Record<string, unknown>>)
        .map((a) => {
          const label = str(a.label) ?? str(a.id)
          const description = str(a.description)
          if (!label && !description) return null
          return description ? `${label ?? 'Angle'} — ${description}` : (label as string)
        })
        .filter((x): x is string => Boolean(x))
    : []
  const provenance = summary ? toRecord(summary.provenance) : null
  const provenanceParts = [
    data.analysis.model ? `model ${data.analysis.model}` : str(provenance?.model) ? `model ${str(provenance?.model)}` : null,
    str(provenance?.engine) ? `engine ${str(provenance?.engine)}` : null,
    str(provenance?.analysis_prompt) ? `prompt ${str(provenance?.analysis_prompt)}` : null,
    str(provenance?.analyzed_at) ? `analyzed ${formatDateLong(str(provenance?.analyzed_at) as string)}` : null,
    str(provenance?.sport) ? `sport ${str(provenance?.sport)}` : summary && str(summary.sport) ? `sport ${str(summary.sport)}` : null,
    num(provenance?.sport_pack_version) !== null
      ? `pack v${num(provenance?.sport_pack_version)}`
      : summary && (typeof summary.sport_pack_version === 'string' || typeof summary.sport_pack_version === 'number')
        ? `pack ${String(summary.sport_pack_version)}`
        : null,
  ].filter(Boolean)
  const shownMoments = 10
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
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta tabular-nums">
          <span>{formatDateLong(data.analysis.requested_at)}</span>
          {data.analysis.model && <span>{data.analysis.model}</span>}
          {angle ? <span>Angle: {angle}{angleSource ? ` (${angleSource})` : ''}</span> : null}
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
                note: compositeContext || null,
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
          {(candidateEvents > 0 || uncertainEvents > 0 || eventDetectionSummary) ? (
            <div className="text-muted-foreground mt-3 space-y-1 text-meta">
              {(candidateEvents > 0 || uncertainEvents > 0) ? (
                <p>
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
              {eventDetectionSummary ? <p>Event detection: {eventDetectionSummary}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {(narrative || tactical || scopeNote) ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Session summary</p>
          </div>
          <div className="space-y-3 p-5 text-body leading-[1.7] text-foreground">
            {narrative ? <p>{narrative}</p> : null}
            {tactical && tactical !== narrative ? <p>{tactical}</p> : null}
            {scopeNote ? <p className="text-meta text-muted-foreground">Scope: {scopeNote}</p> : null}
            {qualityIssues.length > 0 ? (
              <p className="text-meta text-muted-foreground">Quality notes: {qualityIssues.join('; ')}</p>
            ) : null}
            {failureDetails.length > 0 ? (
              <div className="space-y-1">
                {failureDetails.map((note, i) => (
                  <p key={i} className="text-meta text-muted-foreground">{note}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {recommendedAngles.length > 0 ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Recommended angles</p>
          </div>
          <ul className="space-y-2 p-5">
            {recommendedAngles.map((item, i) => (
              <li key={i} className="text-body text-foreground">{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

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

      {summary && str(summary.priority_drill) ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Recommended Drill</p>
          </div>
          <p className="text-foreground p-5 text-body">{str(summary.priority_drill)}</p>
        </div>
      ) : null}

      {findings.length > 0 ? (
        <section className="mb-8">
          <FindingsTimeline findings={findings} />
        </section>
      ) : null}

      {/* Shot events / key moments */}
      {shotEvents.length > 0 ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-lead font-semibold text-foreground">Key moments</p>
            <p className="text-muted-foreground mt-1 text-meta">
              Showing {Math.min(shownMoments, shotEvents.length)} of {shotEvents.length} timeline events. Unconfirmed candidates are not confirmed performance.
            </p>
          </div>
          <ul className="p-5 pt-4">
            {shotEvents.slice(0, shownMoments).map((event, i) => (
              <li
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < Math.min(shownMoments, shotEvents.length) - 1 ? 'border-border border-b' : ''
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
                    {eventStateBadgeLabel(event.event_state) ? (
                      <span className="rounded-full bg-warning/15 px-2 text-label font-medium leading-[18px] text-warning">
                        {eventStateBadgeLabel(event.event_state)}
                      </span>
                    ) : null}
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
                    {typeof event.confidence === 'number' && Number.isFinite(event.confidence) ? (
                      <span className="text-label text-muted-foreground tabular-nums">
                        confidence {formatConfidencePercent(event.confidence)}
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
                  {toRecord(event.matchup)?.primary && toRecord(toRecord(event.matchup)?.primary)?.tracked === false ? (
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

      {(sessionMetrics.length > 0 || proStats || keyInsights.length > 0 || tactical) ? (
        <section className="border-border bg-card mb-8 rounded-[6px] border p-6 space-y-6">
          <div className="-mx-6 -mt-6 border-b border-border px-6 py-3.5">
            <p className="text-lead font-semibold text-foreground">Measured performance & professional stats</p>
          </div>
          {sessionMetrics.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {sessionMetrics.map((metric) => {
                const value = metric.value as number
                const unit = str(metric.unit) ?? ''
                const best = num(metric.best)
                return (
                  <div key={String(metric.key)} className="rounded-[6px] border border-border bg-background px-4 py-3">
                    <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {String(metric.label ?? metric.key)}
                    </p>
                    <p className="mt-1 font-semibold text-[24px] leading-none tabular-nums text-foreground">
                      {formatMetric(value, unit)}
                    </p>
                    {best !== null ? (
                      <p className="mt-1 text-meta text-muted-foreground">best {formatMetric(best, unit)}</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
          {proStats || keyInsights.length > 0 || tactical ? (
            <ProStatsPanel
              stats={proStats}
              tacticalSummary={tactical}
              keyInsights={keyInsights}
              title="Professional breakdown"
            />
          ) : null}
        </section>
      ) : null}

      {summary && (qualityIssues.length > 0 || failureDetails.length > 0) && !(narrative || tactical || scopeNote) ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border p-5 space-y-1">
          {qualityIssues.length > 0 ? (
            <p className="text-meta text-muted-foreground">Quality notes: {qualityIssues.join('; ')}</p>
          ) : null}
          {failureDetails.map((note, i) => (
            <p key={i} className="text-meta text-muted-foreground">{note}</p>
          ))}
        </div>
      ) : null}

      {provenanceParts.length > 0 ? (
        <div className="border-border bg-card mb-8 rounded-[6px] border p-5">
          <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Provenance</p>
          <p className="mt-2 text-meta text-foreground leading-[1.6]">{provenanceParts.join(' · ')}</p>
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

function formatMetric(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded}${unit}`
}

function describeFailure(f: Record<string, unknown>): string {
  const code = str(f.code)
  const stage = str(f.stage)
  const retryable = typeof f.retryable === 'boolean' ? (f.retryable ? 'retryable' : 'not retryable') : null
  const detail = toRecord(f.detail)
  const unseen = Array.isArray(detail?.unseen_candidates) ? detail.unseen_candidates.length : null
  let message = str(f.message) ?? ''
  if (code === 'F07_MISSED_CANDIDATE' && unseen) {
    message = `${unseen} candidate moment${unseen === 1 ? '' : 's'} not shown for model review${message ? ` — ${message}` : ''}`
  }
  if (!message && unseen) message = `${unseen} unseen candidate${unseen === 1 ? '' : 's'}`
  const detailBits = detail
    ? Object.entries(detail)
        .filter(([k, v]) => k !== 'unseen_candidates' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        .slice(0, 3)
        .map(([k, v]) => `${k}=${String(v)}`)
    : []
  const prefix = [code, stage].filter(Boolean).join(' · ')
  const suffix = [retryable, detailBits.length ? detailBits.join(', ') : null].filter(Boolean).join(' · ')
  const core = message || prefix || 'Analysis issue'
  const parts = [prefix && message ? `${prefix}: ${message}` : core]
  if (suffix && !(prefix && message)) parts.push(suffix)
  else if (suffix) parts.push(suffix)
  return parts.join(' · ')
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
  confidence?: unknown
}> {
  return Array.isArray(v)
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = String(Math.round(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}
