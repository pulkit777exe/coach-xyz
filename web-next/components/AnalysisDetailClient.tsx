'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Slide } from 'loading-dev'
import AnalysisTitle from '@/components/AnalysisTitle'
import TimestampPill from '@/components/TimestampPill'
import AnalysisProgress from '@/components/AnalysisProgress'
import ErrorScreen from '@/components/ErrorScreen'
import ResultsSummary from '@/components/ResultsSummary'
import HistoryChat from '@/components/HistoryChat'
import {
  getJobStatus,
  getAuthorizedDownloadUrl,
  getDownloadUrl,
  deleteAnalysis,
  cancelAnalysis,
} from '@/lib/api'
import type { CoachAIError } from '@/lib/api'
import { createShareToken } from '@/lib/aiReports'
import { getShotEvents } from '@/lib/analysis'
import { startAnalysisStatus } from '@/lib/analysisEvents'
import type { JobPollingController } from '@/lib/jobPolling'
import type { JobStatus } from '@/types'
import type { DashboardAnalysis } from '@/lib/api'
import AnalysisLinkControl from '@/components/org/AnalysisLinkControl'
import StatusPill from '@/components/org/StatusPill'
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

const FALLBACK_POLL_ATTEMPTS = 4
const STUCK_WARNING_MS = 5 * 60 * 1000

/** Card heading: 16px/600 over a hairline rule that bleeds to the card edges. */
function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-6 -mt-6 mb-4 border-b border-border px-6 py-3.5">
      <h2 className="text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">
        {children}
      </h2>
    </div>
  )
}

/** Outline action chip used where a full Button can't be the child (hold-to-confirm). */
const CHIP_CLASS =
  'inline-flex items-center rounded-[6px] border border-border px-3 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer'

interface AnalysisDetailClientProps {
  auth0Id: string
  jobId: string
  initialData: DashboardAnalysis | null
  canShareTokens?: boolean
  canLinkToStudent?: boolean
}

export default function AnalysisDetailClient({
  auth0Id,
  jobId,
  initialData,
  canShareTokens = true,
  canLinkToStudent = true,
}: AnalysisDetailClientProps) {
  const router = useRouter()
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [stuckWarning, setStuckWarning] = useState(false)
  const [activeView, setActiveView] = useState('overview')
  const pollControllerRef = useRef<JobPollingController | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const shotEvents = getShotEvents(initialData)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showMetadataDrawer, setShowMetadataDrawer] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareExpires, setShareExpires] = useState<string | null>(null)
  const shareLoadIdRef = useRef(0)
  // Owned jobs need the signed token on the download URL (<a>/lightbox
  // cannot send headers) — resolve per analysis, fall back to the base URL.
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
  const visibleEventCount = showAllEvents ? shotEvents.length : Math.min(5, shotEvents.length)

  useEffect(() => {
    let cancelled = false

    const controller = startAnalysisStatus({
      jobId,
      fetchStatus: getJobStatus,
      isComplete: (s) => s.complete,
      timeoutMs: 12 * 60 * 1000,
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
        setPollError(
          `Connection issue. Retrying... (${failure.attempts}/${FALLBACK_POLL_ATTEMPTS})`,
        )
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

  // Create the share token once the share modal opens; the link is minted per
  // analysis and expires after a fixed window (72h on the server).
  useEffect(() => {
    if (!showShareModal || !initialData) return
    const loadId = ++shareLoadIdRef.current
    createShareToken(auth0Id, initialData.server_job_id)
      .then((res) => {
        if (loadId !== shareLoadIdRef.current) return
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        setShareUrl(`${origin}${res.url}`)
        setShareExpires(res.expires_at)
      })
      .catch((err) => {
        if (loadId !== shareLoadIdRef.current) return
        setShareError((err as CoachAIError).message ?? 'Failed to create share link')
      })
      .finally(() => {
        if (loadId === shareLoadIdRef.current) setShareLoading(false)
      })
  }, [showShareModal, auth0Id, initialData])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Slide size={48} className="mb-4 text-muted-foreground" />
        <p className="text-muted-foreground text-body">Loading analysis...</p>
      </div>
    )
  }

  // ── Expired / Not Found ──────────────────────────────────────────────────
  if (expiredMessage) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <svg
            className="size-16 mx-auto mb-6 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h1 className="text-[30px] font-bold tracking-[-0.015em] text-foreground mb-3">
            Analysis Expired
          </h1>
          <p className="text-muted-foreground text-body mb-6">{expiredMessage}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-[6px] border border-border text-body font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
          <Slide size={40} className="mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground text-body mb-2">Loading analysis...</p>
          <p className="text-destructive text-meta">{pollError}</p>
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
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-[8px] bg-popover border border-border px-6 py-4 text-center shadow-lg">
          <p className="text-muted-foreground text-body mb-3">
            This analysis is taking longer than usual.
          </p>
          <button
            onClick={() => {
              setStuckWarning(false)
              pollControllerRef.current?.refresh()
            }}
            className="rounded-[6px] border border-border px-3 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
        onRetry={() => router.push('/')}
      />
    )
  }

  if (!initialData && status?.complete && status.summary) {
    return <ResultsSummary status={status} jobId={jobId} onReset={() => router.push('/')} />
  }

  if (!initialData) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-[30px] font-bold tracking-[-0.015em] text-foreground mb-3">
            Analysis Expired
          </h1>
          <p className="text-muted-foreground text-body mb-6">Analysis not found or expired.</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-[6px] border border-border text-body font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
  const summary =
    summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)
      ? (summaryRaw as Record<string, unknown>)
      : typeof summaryRaw === 'string'
        ? (() => {
            try {
              return JSON.parse(summaryRaw) as Record<string, unknown>
            } catch {
              return null
            }
          })()
        : null

  const drill: string | null =
    summary && typeof summary.priority_drill === 'string' ? summary.priority_drill : null

  return (
    <div ref={containerRef} className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      {/* Reading Progress */}
      <ReadingProgress scroller={containerRef} className="fixed top-14 left-0 right-0 z-40" />

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
      <div className="flex items-center gap-1.5 mb-6 text-meta text-muted-foreground">
        <span>History</span>
        <span className="text-muted-foreground/60">/</span>
        <span className="text-foreground">{data.display_name || data.file_name || 'Untitled'}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <AnalysisTitle
            auth0Id={auth0Id}
            jobId={jobId}
            displayName={data.display_name}
            fileName={data.file_name}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
            <span className="tabular-nums">
              {new Date(data.requested_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {data.model && <span>{data.model}</span>}
            {data.player_count ? (
              <span className="tabular-nums">
                {data.player_count} player{data.player_count > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill tone={data.complete ? 'green' : ec ? 'red' : 'blue'}>
          {data.complete ? 'Complete' : ec ? 'Failed' : 'In Progress'}
        </StatusPill>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-8">
        {!data.complete && !ec && (
          <HoldToConfirm
            onConfirm={async () => {
              await cancelAnalysis(auth0Id, data.server_job_id)
              router.refresh()
            }}
            confirmLabel="Analysis cancelled"
            className="[&_*]:!text-foreground"
          >
            <span className={CHIP_CLASS}>Cancel</span>
          </HoldToConfirm>
        )}
        {data.complete && data.video_ready && (
          <LoadingButton
            onAction={() => {
              window.location.href = downloadUrl
            }}
            pendingLabel="Downloading..."
            successLabel="Started!"
            className="!rounded-[6px] !border !border-border !bg-transparent !px-3 !py-1.5 !text-meta !font-medium !text-muted-foreground hover:!bg-accent hover:!text-foreground"
          >
            Download Video
          </LoadingButton>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowMetadataDrawer(true)}>
          View Metadata
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLightboxOpen(true)}>
          Preview
        </Button>

        {/* Lightbox */}
        <Lightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={data.video_ready ? downloadUrl : ''}
          alt="Analysis video preview"
        />
        <CopyButton
          value={data.engine_job_id}
          label="Copy Job ID"
          className="!rounded-[6px] !border !border-border !bg-transparent !px-3 !py-1.5 !text-meta !font-medium !text-muted-foreground hover:!bg-accent hover:!text-foreground"
        />
        {canShareTokens ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShareUrl(null)
              setShareError(null)
              setShareExpires(null)
              setShareLoading(true)
              setShowShareModal(true)
            }}
          >
            Share
          </Button>
        ) : null}
        {canLinkToStudent ? (
          <AnalysisLinkControl
            auth0Id={auth0Id}
            jobId={data.server_job_id}
            initialStudentId={data.student_id}
          />
        ) : null}
        <HoldToConfirm
          onConfirm={async () => {
            await deleteAnalysis(auth0Id, data.server_job_id)
            router.push('/dashboard/history')
          }}
          confirmLabel="Analysis deleted"
          className="[&_*]:!text-foreground"
        >
          <span className="inline-flex items-center rounded-[6px] border border-destructive/30 px-3 py-1.5 text-meta font-medium text-destructive transition-colors hover:bg-destructive/10 cursor-pointer">
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
            <p className="text-body text-muted-foreground">
              Anyone with this link can view the analysis — no login required.
            </p>
            {shareLoading ? (
              <div className="flex items-center gap-2 text-body text-muted-foreground">
                <Slide size={16} className="inline-block" />
                Creating share link…
              </div>
            ) : shareError ? (
              <p className="text-meta text-destructive">{shareError}</p>
            ) : shareUrl ? (
              <>
                <div className="flex gap-2">
                  {/* The <p> above is prose, not a label: without this the field
                      is announced as an unnamed text box and a screen reader
                      user reads the URL as an unlabelled edit box. */}
                  <label htmlFor="analysis-share-url" className="sr-only">
                    Share link
                  </label>
                  <input
                    id="analysis-share-url"
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 bg-background border border-border rounded-[6px] px-3 py-2 text-body text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <CopyButton
                    value={shareUrl}
                    label="Copy link"
                    className="!rounded-[6px] !border !border-border !bg-transparent !px-3 !py-1.5 !text-meta !font-medium"
                  />
                </div>
                {shareExpires && (
                  <p className="text-meta text-muted-foreground tabular-nums">
                    Expires {new Date(shareExpires).toLocaleString()}
                  </p>
                )}
              </>
            ) : null}
          </div>
        </Modal>
      </div>

      {/* Error */}
      {ec && (
        <div className="rounded-[6px] border border-destructive/20 bg-destructive/10 p-5 mb-8">
          <p className="mb-2 text-meta font-medium text-destructive">Error — {ec}</p>
          <p className="text-body text-muted-foreground">{em}</p>
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
              value: 'form_score' in summary ? (summary.form_score as number) : '—',
            },
            {
              label: 'Confidence',
              value:
                'confidence' in summary
                  ? `${((summary.confidence as number) * 100).toFixed(0)}%`
                  : '—',
            },
            {
              label: 'Total Events',
              value: 'total_events' in summary ? (summary.total_events as number) : '—',
            },
            {
              label: 'Duration',
              value:
                'duration_sec' in summary ? `${Math.round(summary.duration_sec as number)}s` : '—',
            },
          ].map((card) => (
            <div key={card.label} className="rounded-[6px] border border-border bg-card p-5">
              <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 font-semibold text-[28px] leading-none tabular-nums text-foreground">
                {card.value}
              </p>
              {card.label === 'Form Score' && (
                <Popover
                  trigger="click"
                  label="Form score is calculated by AI based on technique, mechanics, and body position across all keyframes."
                  className="[&_*]:!text-foreground"
                >
                  <span className="mt-2 inline-block cursor-help text-meta text-muted-foreground underline decoration-dotted">
                    What is this?
                  </span>
                </Popover>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shot Events with Reorder */}
      {summary &&
        'shot_events' in summary &&
        Array.isArray(summary.shot_events) &&
        shotEvents.length > 0 && (
          <div className="rounded-[6px] border border-border bg-card p-6 mb-8">
            <CardHeading>Event Priority (drag to reorder)</CardHeading>
            <ReorderList
              items={shotEvents.slice(0, 5)}
              getId={(e) => (typeof e.event_type === 'string' ? e.event_type : 'event')}
              getLabel={(e) => (typeof e.event_type === 'string' ? e.event_type : 'Event')}
              onReorder={() => {}}
              label="Shot events"
              className="[&_*]:!text-foreground"
            >
              {(event) => (
                <div className="flex items-center gap-3 py-2">
                  <TimestampPill
                    seconds={typeof event.timestamp === 'number' ? event.timestamp : 0}
                  />
                  <span className="text-body text-foreground">
                    {typeof event.event_type === 'string' ? event.event_type : 'Event'}
                  </span>
                  {typeof event.form_score === 'number' && (
                    <span
                      className={`text-label font-medium px-1.5 py-0.5 rounded-full ${
                        event.form_score >= 8
                          ? 'bg-success/15 text-success'
                          : event.form_score >= 5
                            ? 'bg-warning/15 text-warning'
                            : 'bg-destructive/10 text-destructive'
                      }`}
                    >
                      <span className="tabular-nums">{event.form_score}/10</span>
                    </span>
                  )}
                </div>
              )}
            </ReorderList>
          </div>
        )}

      {/* Shot Events with Show More */}
      {summary && 'shot_events' in summary && Array.isArray(summary.shot_events) && (
        <div className="rounded-[6px] border border-border bg-card p-6 mb-8">
          <CardHeading>
            Shot Events{' '}
            {shotEvents.length > visibleEventCount &&
              `(${visibleEventCount} of ${shotEvents.length})`}
          </CardHeading>
          <div className="space-y-0">
            {shotEvents.slice(0, visibleEventCount).map((event, i) => (
              <div
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < shotEvents.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                {typeof event.timestamp === 'number' && <TimestampPill seconds={event.timestamp} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-body text-foreground">
                      {typeof event.event_type === 'string' ? event.event_type : 'Event'}
                    </p>
                    {typeof event.form_score === 'number' && (
                      <span
                        className={`text-label font-medium px-1.5 py-0.5 rounded-full ${
                          event.form_score >= 8
                            ? 'bg-success/15 text-success'
                            : event.form_score >= 5
                              ? 'bg-warning/15 text-warning'
                              : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        <span className="tabular-nums">{event.form_score}/10</span>
                      </span>
                    )}
                  </div>
                  {typeof event.feedback === 'string' && (
                    <p className="mt-1 text-meta text-muted-foreground">{event.feedback}</p>
                  )}
                  {typeof event.key_observation === 'string' && (
                    <p className="mt-0.5 text-meta text-muted-foreground">
                      {event.key_observation}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {shotEvents.length > visibleEventCount && (
            <button
              onClick={() => setShowAllEvents(true)}
              className="mt-4 text-meta font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded"
            >
              Show all <span className="tabular-nums">{shotEvents.length}</span> events →
            </button>
          )}
        </div>
      )}

      {/* Tips & Strengths */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {'top_tips' in summary &&
            Array.isArray(summary.top_tips) &&
            (summary.top_tips as string[]).length > 0 && (
              <div className="rounded-[6px] border border-border bg-card p-6">
                <CardHeading>Priority Focus</CardHeading>
                <ShowMore lines={3} className="[&_*]:!text-foreground">
                  <ul className="space-y-2">
                    {(summary.top_tips as string[]).map((tip, i) => (
                      <li key={i} className="text-body text-foreground flex items-start gap-2">
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {i + 1}.
                        </span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </ShowMore>
              </div>
            )}

          {'strengths' in summary &&
            Array.isArray(summary.strengths) &&
            (summary.strengths as string[]).length > 0 && (
              <div className="rounded-[6px] border border-border bg-card p-6">
                <CardHeading>Strengths</CardHeading>
                <ul className="space-y-2">
                  {(summary.strengths as string[]).map((s, i) => (
                    <li key={i} className="text-body text-foreground flex items-start gap-2">
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
        <div className="rounded-[6px] border border-border bg-card p-6 mb-8">
          <CardHeading>Recommended Drill</CardHeading>
          <p className="text-body text-foreground">{drill}</p>
        </div>
      )}

      {/* Analysis Structure Tree */}
      {summary && (
        <div className="rounded-[6px] border border-border bg-card p-6 mb-8">
          <CardHeading>Analysis Structure</CardHeading>
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
      <div className="rounded-[6px] border border-border bg-card p-6">
        <CardHeading>Metadata</CardHeading>
        <dl className="grid grid-cols-2 gap-4 text-body">
          <div>
            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">
              Job ID
            </dt>
            <dd className="text-foreground font-mono text-meta break-all">{data.engine_job_id}</dd>
          </div>
          {data.session_token && (
            <div>
              <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">
                Session Token
              </dt>
              <dd className="text-foreground font-mono text-meta break-all">
                {data.session_token}
              </dd>
            </div>
          )}
          {data.completed_at && (
            <div>
              <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">
                Completed
              </dt>
              <dd className="text-foreground tabular-nums">
                {new Date(data.completed_at).toLocaleString()}
              </dd>
            </div>
          )}
          {data.download_count > 0 && (
            <div>
              <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">
                Downloads
              </dt>
              <dd className="text-foreground tabular-nums">{data.download_count}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Chat */}
      {summary && (
        <div className="mt-8">
          <h2 className="mb-3 text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">
            Chat with AI
          </h2>
          <div
            className="rounded-[6px] border border-border bg-card overflow-hidden"
            style={{ height: 'min(500px, 60vh)' }}
          >
            <HistoryChat auth0Id={auth0Id} jobId={jobId} summary={summary} />
          </div>
        </div>
      )}

      {/* Feedback Poll Results */}
      {summary && (
        <div className="mt-8 rounded-[6px] border border-border bg-card p-6">
          <CardHeading>Community Feedback</CardHeading>
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
          <dl className="space-y-3 text-body">
            <div>
              <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Job ID
              </dt>
              <dd className="text-foreground font-mono text-meta break-all mt-1">
                {data.engine_job_id}
              </dd>
            </div>
            {data.session_token && (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Session Token
                </dt>
                <dd className="text-foreground font-mono text-meta break-all mt-1">
                  {data.session_token}
                </dd>
              </div>
            )}
            {data.completed_at && (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Completed
                </dt>
                <dd className="text-foreground mt-1 tabular-nums">
                  {new Date(data.completed_at).toLocaleString()}
                </dd>
              </div>
            )}
            {data.download_count > 0 && (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Downloads
                </dt>
                <dd className="text-foreground mt-1 tabular-nums">{data.download_count}</dd>
              </div>
            )}
          </dl>
        </div>
      </Drawer>
    </div>
  )
}
