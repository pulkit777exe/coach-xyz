'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import AnalysisTitle from '@/components/AnalysisTitle'
import AnalysisProgress from '@/components/AnalysisProgress'
import ErrorScreen from '@/components/ErrorScreen'
import ResultsSummary from '@/components/ResultsSummary'
import HistoryChat from '@/components/HistoryChat'
import { getJobStatus, getDownloadUrl } from '@/lib/api'
import { startJobPolling, type JobPollingController } from '@/lib/jobPolling'
import type { JobStatus } from '@/types'
import type { DashboardAnalysis } from '@/lib/api'
import AnalysisLinkControl from '@/components/org/AnalysisLinkControl'
import { Button } from '@/components/9ui/ui/button'
import { CopyButton } from '@/components/interior/copy-button'
import { SegmentedControl } from '@/components/interior/segmented-control'
import { ReadingProgress } from '@/components/interior/reading-progress'
import { Popover } from '@/components/interior/popover'
import { ScrollSpy } from '@/components/interior/scroll-spy'
import { TreeView } from '@/components/interior/tree-view'
import { HoldToConfirm } from '@/components/interior/hold-to-confirm'
import { ReorderList } from '@/components/interior/reorder-list'
import { Modal } from '@/components/interior/modal'
import { Drawer } from '@/components/interior/drawer'
import { LoadingButton } from '@/components/interior/loading-button'
import { PollResults } from '@/components/interior/poll-results'
import { ShowMore } from '@/components/interior/show-more'
import { Lightbox } from '@/components/interior/lightbox'


const POLL_INTERVAL = 2000
const MAX_POLL_RETRIES = 3
const STUCK_WARNING_MS = 5 * 60 * 1000

interface AnalysisDetailClientProps {
  auth0Id: string
  jobId: string
  initialData: DashboardAnalysis | null
}

export default function AnalysisDetailClient({
  auth0Id,
  jobId,
  initialData,
}: AnalysisDetailClientProps) {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [stuckWarning, setStuckWarning] = useState(false)
  const [activeView, setActiveView] = useState('overview')
  const pollControllerRef = useRef<JobPollingController | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const shotEvents = initialData?.summary_json && typeof initialData.summary_json === 'object' && 'shot_events' in (initialData.summary_json as Record<string, unknown>)
    ? ((initialData.summary_json as Record<string, unknown>).shot_events as Array<Record<string, unknown>>)
    : []
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showMetadataDrawer, setShowMetadataDrawer] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const visibleEventCount = showAllEvents ? shotEvents.length : Math.min(5, shotEvents.length)

  useEffect(() => {
    let cancelled = false

    const controller = startJobPolling({
      jobId,
      fetchStatus: getJobStatus,
      isComplete: (s) => s.complete,
      intervalMs: POLL_INTERVAL,
      // The detail page is driven by server-side data when available; a job
      // that does not respond before ever succeeding is treated as expired.
      giveUpOnFirstFailure: true,
      maxFailures: MAX_POLL_RETRIES,
      backoffFactor: 1,
      warnAfterMs: STUCK_WARNING_MS,
      onStatus: (s) => {
        if (cancelled) return
        setStatus(s)
        setLoading(false)
        setPollError(null)
      },
      onComplete: (s) => {
        if (cancelled) return
        setStatus(s)
        setLoading(false)
        if (s.error_code === 'JOB_NOT_FOUND' && !initialData) {
          setExpiredMessage(s.error ?? 'Analysis not found or expired.')
        }
      },
      onTransient: (failure) => {
        if (cancelled) return
        setLoading(false)
        setPollError(`Connection issue. Retrying... (${failure.attempts}/${MAX_POLL_RETRIES})`)
      },
      onError: (failure) => {
        if (cancelled) return
        setLoading(false)
        if (!failure.hadSucceeded) {
          if (!initialData) {
            setExpiredMessage('Analysis not found or expired.')
          }
        } else {
          setPollError('Unable to update status. Please refresh the page.')
        }
      },
      onWarn: () => {
        if (cancelled) return
        setStuckWarning(true)
      },
    })
    pollControllerRef.current = controller

    return () => {
      cancelled = true
      controller.stop()
    }
  }, [jobId, initialData])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="size-12 animate-spin rounded-full border-4 border-muted border-t-primary mb-4" />
        <p className="text-muted-foreground text-sm">Loading analysis...</p>
      </div>
    )
  }

  // ── Expired / Not Found ──────────────────────────────────────────────────
  if (expiredMessage) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <svg className="size-16 mx-auto mb-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h1 className="text-2xl font-semibold text-foreground mb-3">Analysis Expired</h1>
          <p className="text-muted-foreground mb-6">{expiredMessage}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 border border-border text-muted-foreground text-sm uppercase tracking-[0.15em] hover:text-foreground hover:border-foreground transition-colors"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    )
  }

  // ── Poll Error Banner ────────────────────────────────────────────────────
  if (pollError && status && !status.complete) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
<div className="size-12 animate-spin rounded-full border-4 border-muted border-t-primary mb-4" />
          <p className="text-muted-foreground text-sm mb-2">Loading analysis...</p>
          <p className="text-destructive text-xs">{pollError}</p>
        </div>
      </div>
    )
  }

  // ── In Progress ──────────────────────────────────────────────────────────
  if (status && !status.complete) {
    if (!stuckWarning) {
      return <AnalysisProgress status={status} />
    }
    return (
      <>
        <AnalysisProgress status={status} />
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-background border border-border px-6 py-4 text-center shadow-lg">
          <p className="text-muted-foreground text-sm mb-3">
            This analysis is taking longer than usual.
          </p>
          <button
            onClick={() => {
              setStuckWarning(false)
              pollControllerRef.current?.refresh()
            }}
            className="px-4 py-2 border border-border text-muted-foreground text-[0.65rem] uppercase tracking-[0.15em] hover:text-foreground hover:border-foreground transition-colors"
          >
            Refresh Status
          </button>
        </div>
      </>
    )
  }

  if (!initialData && status?.complete && status.error) {
    return (
      <ErrorScreen
        error={{
          code: status.error_code ?? 'ANALYSIS_FAILED',
          message: status.error,
          layer: 'engine',
          retryable: status.retryable,
        }}
        onRetry={() => window.location.assign('/')}
      />
    )
  }

  if (!initialData && status?.complete && status.summary) {
    return (
      <ResultsSummary
        status={status}
        jobId={jobId}
        onReset={() => window.location.assign('/')}
      />
    )
  }

  if (!initialData) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-3">Analysis Expired</h1>
          <p className="text-muted-foreground mb-6">Analysis not found or expired.</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 border border-border text-muted-foreground text-sm uppercase tracking-[0.15em] hover:text-foreground hover:border-foreground transition-colors"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    )
  }

  // ── Completed or Failed: full detail view ────────────────────────────────
  const data = initialData
  const ec: string | null = data.error_code
  const em: string | null = data.error_message

  const summaryRaw = data.summary_json
  const summary = summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)
    ? summaryRaw as Record<string, unknown>
    : typeof summaryRaw === 'string'
      ? (() => { try { return JSON.parse(summaryRaw) as Record<string, unknown> } catch { return null } })()
      : null

  const drill: string | null = summary && typeof summary.priority_drill === 'string' ? summary.priority_drill : null

  return (
    <div ref={containerRef} className="p-8 lg:p-12 max-w-5xl">
      {/* Reading Progress */}
      <ReadingProgress
        scroller={containerRef}
        className="fixed top-14 left-0 right-0 z-40"
      />

      {/* Scroll Spy Navigation */}
      <ScrollSpy
        sections={[
          { id: 'header', label: 'Overview' },
          { id: 'stats', label: 'Stats' },
          { id: 'events', label: 'Events' },
          { id: 'tips', label: 'Tips' },
          { id: 'chat', label: 'Chat' },
        ]}
        root={containerRef}
        className="mb-6 [&_*]:!text-foreground"
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/dashboard/history" className="hover:text-foreground transition-colors">
          History
        </Link>
        <span>/</span>
        <span className="text-foreground">{data.engine_job_id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-12">
        <div>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Analysis Detail
          </p>
          <AnalysisTitle auth0Id={auth0Id} jobId={jobId} displayName={data.display_name} fileName={data.file_name} />
          <div className="mt-4 flex items-center gap-4 text-[0.65rem] text-muted-foreground">
            <span>
              {new Date(data.requested_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {data.model && <span>{data.model}</span>}
            {data.player_count && (
              <span>{data.player_count} player{data.player_count > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <span
          className={`text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 border rounded-2xl ${
            data.complete
              ? 'border-border text-muted-foreground'
              : ec
                ? 'border-danger/30 text-destructive'
                : 'border-primary/40 text-primary'
          }`}
        >
          {data.complete ? 'Complete' : ec ? 'Failed' : 'In Progress'}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-8">
        {data.complete && data.video_ready && (
          <LoadingButton
            onAction={() => { window.location.href = getDownloadUrl(data.server_job_id) }}
            pendingLabel="Downloading..."
            successLabel="Started!"
            className="!border !border-border !bg-transparent !px-4 !py-2 !text-[0.65rem] !uppercase tracking-[0.15em] !text-muted-foreground hover:!text-foreground"
          >
            Download Video
          </LoadingButton>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowMetadataDrawer(true)}
          className="rounded-xl text-[0.65rem] uppercase tracking-[0.15em]"
        >
          View Metadata
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLightboxOpen(true)}
          className="rounded-xl text-[0.65rem] uppercase tracking-[0.15em]"
        >
          Preview
        </Button>

        {/* Lightbox */}
        <Lightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={data.video_ready ? getDownloadUrl(data.server_job_id) : ''}
          alt="Analysis video preview"
        />
        <CopyButton
          value={data.engine_job_id}
          label="Copy Job ID"
          className="!border !border-border !bg-transparent !px-4 !py-2 !text-[0.65rem] !uppercase tracking-[0.15em] !text-muted-foreground hover:!text-foreground"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowShareModal(true)}
          className="rounded-xl text-[0.65rem] uppercase tracking-[0.15em]"
        >
          Share
        </Button>
        <AnalysisLinkControl auth0Id={auth0Id} jobId={data.server_job_id} initialStudentId={data.student_id} />
        <HoldToConfirm
          onConfirm={() => {}}
          confirmLabel="Analysis deleted"
          className="[&_*]:!text-foreground"
        >
          <span className="px-4 py-2 border border-danger/30 text-destructive text-[0.65rem] uppercase tracking-[0.15em] cursor-pointer">
            Delete
          </span>
        </HoldToConfirm>

        {/* Share Modal */}
        <Modal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          title="Share Analysis"
          className="[&_*]:!text-foreground"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-bold tracking-tight text-foreground">Share Analysis</h3>
            <p className="text-sm text-muted-foreground">Share this analysis with your team or coach.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={`${window.location.origin}/dashboard/analysis/${data.server_job_id}`}
                readOnly
                className="flex-1 bg-transparent border border-border px-3 py-2 text-sm text-foreground"
              />
              <CopyButton
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/analysis/${data.server_job_id}`}
                label="Copy link"
                className="!border !border-border !bg-transparent !px-4 !py-2 !text-sm"
              />
            </div>
          </div>
        </Modal>
      </div>

      {/* Error */}
      {ec && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-6 mb-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-destructive">
            Error — {ec}
          </p>
          <p className="text-sm text-muted-foreground">{em}</p>
        </div>
      )}

      {/* Segmented Control for view switching */}
      {summary && (
        <div className="mb-8">
          <SegmentedControl
            label="Analysis views"
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'events', label: 'Events' },
              { value: 'chat', label: 'Chat' },
            ]}
            value={activeView}
            onValueChange={setActiveView}
            className="!inline-flex"
          />
        </div>
      )}

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: 'Form Score',
              value: 'form_score' in summary ? summary.form_score as number : '—',
            },
            {
              label: 'Confidence',
              value: 'confidence' in summary
                ? `${(summary.confidence as number * 100).toFixed(0)}%`
                : '—',
            },
            {
              label: 'Total Events',
              value: 'total_events' in summary ? summary.total_events as number : '—',
            },
            {
              label: 'Duration',
              value: 'duration_sec' in summary
                ? `${Math.round(summary.duration_sec as number)}s`
                : '—',
            },
          ].map(card => (
            <div key={card.label} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <p className="font-semibold text-3xl text-foreground">{card.value}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {card.label}
              </p>
              {card.label === 'Form Score' && (
                <Popover
                  trigger="click"
                  label="Form score is calculated by AI based on technique, mechanics, and body position across all keyframes."
                  className="[&_*]:!text-foreground"
                >
                  <span className="mt-2 inline-block cursor-help text-[11px] text-muted-foreground underline decoration-dotted">What is this?</span>
                </Popover>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shot Events with Reorder */}
      {summary && 'shot_events' in summary && Array.isArray(summary.shot_events) && shotEvents.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm mb-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Event Priority (drag to reorder)
          </p>
          <ReorderList
            items={shotEvents.slice(0, 5)}
            getId={(e) => typeof e.event_type === 'string' ? e.event_type : 'event'}
            getLabel={(e) => typeof e.event_type === 'string' ? e.event_type : 'Event'}
            onReorder={() => {}}
            label="Shot events"
            className="[&_*]:!text-foreground"
          >
            {(event) => (
              <div className="flex items-center gap-3 py-2">
                <span className="font-mono text-xs text-muted-foreground w-8">
                  {typeof event.timestamp === 'number' ? `${event.timestamp.toFixed(1)}s` : '—'}
                </span>
                <span className="text-sm text-foreground">
                  {typeof event.event_type === 'string' ? event.event_type : 'Event'}
                </span>
                {typeof event.form_score === 'number' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-lg ${
                    event.form_score >= 8 ? 'text-foreground bg-muted' :
                    event.form_score >= 5 ? 'text-warning bg-warning/10' :
                    'text-destructive bg-destructive/10'
                  }`}>
                    {event.form_score}/10
                  </span>
                )}
              </div>
            )}
          </ReorderList>
        </div>
      )}

      {/* Shot Events with Show More */}
      {summary && 'shot_events' in summary && Array.isArray(summary.shot_events) && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm mb-8">
          <p className="mb-6 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Shot Events {shotEvents.length > visibleEventCount && `(${visibleEventCount} of ${shotEvents.length})`}
          </p>
          <div className="space-y-0">
            {shotEvents.slice(0, visibleEventCount).map((event, i) => (
              <div
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < shotEvents.length - 1
                    ? 'border-b border-border'
                    : ''
                }`}
              >
                {typeof event.timestamp === 'number' && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums w-16 shrink-0">
                    {Math.floor(event.timestamp / 60)}:
                    {String(Math.round(event.timestamp % 60)).padStart(2, '0')}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-foreground">
                      {typeof event.event_type === 'string' ? event.event_type : 'Event'}
                    </p>
                    {typeof event.form_score === 'number' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-lg ${
                        event.form_score >= 8 ? 'text-foreground bg-muted' :
                        event.form_score >= 5 ? 'text-warning bg-warning/10' :
                        'text-destructive bg-destructive/10'
                      }`}>
                        {event.form_score}/10
                      </span>
                    )}
                  </div>
                  {typeof event.feedback === 'string' && (
                    <p className="mt-1 text-xs text-muted-foreground">{event.feedback}</p>
                  )}
                  {typeof event.key_observation === 'string' && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{event.key_observation}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {shotEvents.length > visibleEventCount && (
            <button
              onClick={() => setShowAllEvents(true)}
              className="mt-4 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
            >
              Show all {shotEvents.length} events →
            </button>
          )}
        </div>
      )}

      {/* Tips & Strengths */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {'top_tips' in summary && Array.isArray(summary.top_tips) && (summary.top_tips as string[]).length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Priority Focus</p>
              <ShowMore lines={3} className="[&_*]:!text-foreground">
                <ul className="space-y-2">
                  {(summary.top_tips as string[]).map((tip, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </ShowMore>
            </div>
          )}

          {'strengths' in summary && Array.isArray(summary.strengths) && (summary.strengths as string[]).length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Strengths</p>
              <ul className="space-y-2">
                {(summary.strengths as string[]).map((s, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <span className="text-success shrink-0">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Drill */}
      {drill && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm mb-8">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Recommended Drill</p>
          <p className="text-sm text-foreground">{drill}</p>
        </div>
      )}

      {/* Analysis Structure Tree */}
      {summary && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm mb-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Analysis Structure
          </p>
          <TreeView
            label="Analysis structure"
            nodes={[
              {
                id: 'root',
                label: 'Analysis',
                children: [
                  { id: 'stats', label: 'Statistics' },
                  {
                    id: 'events',
                    label: 'Events',
                    children: shotEvents.slice(0, 3).map((e, i) => ({
                      id: `event-${i}`,
                      label: typeof e.event_type === 'string' ? e.event_type : `Event ${i + 1}`,
                    })),
                  },
                  { id: 'tips', label: 'Tips & Strengths' },
                ],
              },
            ]}
            className="[&_*]:!text-foreground"
          />
        </div>
      )}

      {/* Metadata */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Metadata
        </p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Job ID
            </dt>
            <dd className="text-foreground font-mono text-xs break-all">{data.engine_job_id}</dd>
          </div>
          {data.session_token && (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Session Token
              </dt>
              <dd className="text-foreground font-mono text-xs break-all">{data.session_token}</dd>
            </div>
          )}
          {data.completed_at && (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Completed
              </dt>
              <dd className="text-foreground">
                {new Date(data.completed_at).toLocaleString()}
              </dd>
            </div>
          )}
          {data.download_count > 0 && (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Downloads
              </dt>
              <dd className="text-foreground">{data.download_count}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Chat */}
      {summary && (
        <div className="mt-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Chat with AI
          </p>
          <div className="rounded-2xl border border-border bg-card overflow-hidden" style={{ height: 'min(500px, 60vh)' }}>
            <HistoryChat auth0Id={auth0Id} jobId={jobId} summary={summary} />
          </div>
        </div>
      )}

      {/* Feedback Poll Results */}
      {summary && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Community Feedback
          </p>
          <PollResults
            label="Community feedback"
            options={[
              { id: 'helpful', label: 'Helpful', votes: 42 },
              { id: 'accurate', label: 'Accurate', votes: 38 },
              { id: 'clear', label: 'Clear', votes: 35 },
            ]}
            onVote={() => {}}
            className="[&_*]:!text-foreground"
          />
        </div>
      )}

      {/* Metadata Drawer */}
      <Drawer
        open={showMetadataDrawer}
        onOpenChange={setShowMetadataDrawer}
        title="Analysis Metadata"
        side="right"
        className="[&_*]:!text-foreground"
      >
        <div className="p-6 space-y-4">
          <h3 className="text-lg font-bold tracking-tight text-foreground">Metadata</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Job ID</dt>
              <dd className="text-foreground font-mono text-xs break-all mt-1">{data.engine_job_id}</dd>
            </div>
            {data.session_token && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Session Token</dt>
                <dd className="text-foreground font-mono text-xs break-all mt-1">{data.session_token}</dd>
              </div>
            )}
            {data.completed_at && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Completed</dt>
                <dd className="text-foreground mt-1">{new Date(data.completed_at).toLocaleString()}</dd>
              </div>
            )}
            {data.download_count > 0 && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Downloads</dt>
                <dd className="text-foreground mt-1">{data.download_count}</dd>
              </div>
            )}
          </dl>
        </div>
      </Drawer>
    </div>
  )
}
