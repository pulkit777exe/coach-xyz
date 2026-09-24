import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { ClockIcon, LinkIcon } from 'lucide-react'
import { resolveShareToken } from '@/lib/aiReports'
import type { SharedAnalysis } from '@/lib/aiReports'
import type { CoachAIError } from '@/lib/api'
import { formatDateLong } from '@/lib/date'

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
          <p className="text-muted-foreground mt-2 text-[14px]">{problem?.message}</p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Ask the coach who shared it to create a new link.
          </p>
        </div>
      </main>
    )
  }

  const summary = toRecord(data.analysis.summary_json)
  const shotEvents = summary && isEvents(summary.shot_events) ? summary.shot_events : []
  const label = data.analysis.display_name || data.server_job_id.slice(0, 8)

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      {/* Header */}
      <div className="mb-10">
        <p className="text-muted-foreground mb-3 text-[11px] font-medium uppercase tracking-[0.08em]">
          Shared Analysis
        </p>
        <h1 className="text-foreground text-[30px] font-bold tracking-[-0.015em]">{label}</h1>
        <div className="text-muted-foreground mt-2 flex items-center gap-3 text-[13px] tabular-nums">
          <span>{formatDateLong(data.analysis.requested_at)}</span>
          {data.analysis.model && <span>{data.analysis.model}</span>}
        </div>
      </div>

      {/* Stats */}
      {summary && (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Form Score', value: fmtStat(num(summary.form_score), '—') },
            {
              label: 'Confidence',
              value:
                num(summary.confidence) === null
                  ? '—'
                  : `${Math.round(num(summary.confidence)! * 100)}%`,
            },
            { label: 'Total Events', value: fmtStat(num(summary.total_events), '—') },
            {
              label: 'Duration',
              value:
                num(summary.duration_sec) === null
                  ? '—'
                  : `${Math.round(num(summary.duration_sec)!)}s`,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="border-border bg-card rounded-[6px] border p-5"
            >
              <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.08em]">
                {card.label}
              </p>
              <p className="text-foreground mt-2 text-[28px] font-semibold leading-none tabular-nums">
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tips, strengths, drill */}
      {summary && (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {strArray(summary.top_tips).length > 0 && (
            <div className="border-border bg-card rounded-[6px] border">
              <div className="border-b border-border px-5 py-3.5">
                <p className="text-[16px] font-semibold text-foreground">Priority Focus</p>
              </div>
              <ul className="space-y-2 p-5">
                {strArray(summary.top_tips).map((tip, i) => (
                  <li key={i} className="text-foreground flex items-start gap-2 text-[14px]">
                    <span className="text-muted-foreground shrink-0 tabular-nums">{i + 1}.</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {strArray(summary.strengths).length > 0 && (
            <div className="border-border bg-card rounded-[6px] border">
              <div className="border-b border-border px-5 py-3.5">
                <p className="text-[16px] font-semibold text-foreground">Strengths</p>
              </div>
              <ul className="space-y-2 p-5">
                {strArray(summary.strengths).map((s, i) => (
                  <li key={i} className="text-foreground flex items-start gap-2 text-[14px]">
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
            <p className="text-[16px] font-semibold text-foreground">Recommended Drill</p>
          </div>
          <p className="text-foreground p-5 text-[14px]">{str(summary.priority_drill)}</p>
        </div>
      )}

      {/* Shot events */}
      {shotEvents.length > 0 && (
        <div className="border-border bg-card mb-8 rounded-[6px] border">
          <div className="border-b border-border px-5 py-3.5">
            <p className="text-[16px] font-semibold text-foreground">Shot Events</p>
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
                  <span className="text-muted-foreground font-mono text-[13px] tabular-nums w-16 shrink-0">
                    {mmss(event.timestamp)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground text-[14px]">{str(event.event_type) ?? 'Event'}</p>
                    {typeof event.form_score === 'number' && (
                      <span
                        className={`rounded-full px-2 text-[11px] font-medium leading-[18px] tabular-nums ${
                          event.form_score >= 8
                            ? 'text-success bg-success/15'
                            : event.form_score >= 5
                              ? 'text-warning bg-warning/15'
                              : 'text-destructive bg-destructive/10'
                        }`}
                      >
                        {event.form_score}/10
                      </span>
                    )}
                  </div>
                  {str(event.feedback) && (
                    <p className="text-muted-foreground mt-1 text-[13px]">{str(event.feedback)}</p>
                  )}
                  {str(event.key_observation) && (
                    <p className="text-muted-foreground mt-0.5 text-[13px]">
                      {str(event.key_observation)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!summary && (
        <div className="border-border bg-card rounded-[6px] border p-6 text-[14px]">
          <p className="text-muted-foreground">This analysis has no summary to display.</p>
        </div>
      )}

      <p className="text-muted-foreground text-center text-[13px] tabular-nums">
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

function fmtStat(v: number | null, fallback: string): string {
  return v === null ? fallback : String(v)
}

function isEvents(v: unknown): v is Array<{
  timestamp?: unknown
  event_type?: unknown
  form_score?: unknown
  feedback?: unknown
  key_observation?: unknown
}> {
  return Array.isArray(v)
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = String(Math.round(seconds % 60)).padStart(2, '0')
  return `${m}:${s}`
}
