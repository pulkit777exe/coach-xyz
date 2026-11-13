'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Slide } from 'loading-dev'
import AnalysisTitle from '@/components/AnalysisTitle'
import TimestampPill from '@/components/TimestampPill'
import AnalysisProgress from '@/components/AnalysisProgress'
import ErrorScreen from '@/components/ErrorScreen'
import ProStatsPanel from '@/components/analysis/ProStatsPanel'
import FindingsTimeline from '@/components/FindingsTimeline'

const ResultsSummary = dynamic(() => import('@/components/ResultsSummary'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center pt-20">
      <Slide />
    </div>
  ),
})
import HistoryChat from '@/components/HistoryChat'
import { VideoPlayer } from '@/components/VideoPlayer'
import { getJobStatus, getAuthorizedDownloadUrl, getDownloadUrl } from '@/lib/scan'
import type { CoachAIError } from '@/lib/data/errors'
import { createShareToken } from '@/lib/aiReports'
import { getShotEvents, summaryNumber } from '@/lib/analysis'
import {
  eventStateBadgeLabel,
  formatAverageScore,
  formatConfidencePercent,
  formatFormScore,
  formatRatePercent,
  getEventDetectionCounts,
} from '@/lib/analysisDisplay'
import { startAnalysisStatus } from '@/lib/analysisEvents'
import type { JobPollingController } from '@/lib/jobPolling'
import type {
  JobStatus,
  AnalysisSummary,
  Matchup,
  PerformanceMetric,
  ProfessionalStats,
  Finding,
  CriteriaRegistryEntry,
} from '@/types'
import { cancelAnalysis, deleteAnalysis, type DashboardAnalysis } from '@/lib/library'
import AnalysisLinkControl from '@/components/org/AnalysisLinkControl'
import StatusPill from '@/components/org/StatusPill'
import { Button } from '@/components/9ui/ui/button'
import { CopyButton } from '@/components/interior/copy-button'
import { HoldToConfirm } from '@/components/interior/hold-to-confirm'
import { Modal } from '@/components/interior/modal'
import { Drawer } from '@/components/interior/drawer'
import { LoadingButton } from '@/components/interior/loading-button'
import { formatDateTime } from '@/lib/date'

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

const CHIP_CLASS =
  'inline-flex items-center rounded-[6px] border border-border px-3 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer'

function formatMetric(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded}${unit}`
}

/* formatting helpers live in @/lib/analysisDisplay */

function eventMetrics(event: Record<string, unknown>): PerformanceMetric[] {
  return Array.isArray(event.metrics) ? (event.metrics as PerformanceMetric[]) : []
}

function eventMatchup(event: Record<string, unknown>): Matchup | null {
  const raw = event.matchup
  return raw && typeof raw === 'object' ? (raw as Matchup) : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

interface AnalysisDetailClientProps {
  auth0Id: string
  jobId: string
  initialData: DashboardAnalysis | null
  initialLoadFailed?: boolean
  canShareTokens?: boolean
  canLinkToStudent?: boolean
}

export default function AnalysisDetailClient({
  auth0Id,
  jobId,
  initialData,
  initialLoadFailed = false,
  canShareTokens = true,
  canLinkToStudent = true,
}: AnalysisDetailClientProps) {
  const router = useRouter()
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [stuckWarning, setStuckWarning] = useState(false)
  const pollControllerRef = useRef<JobPollingController | null>(null)

  const [showShareModal, setShowShareModal] = useState(false)
  const [showMetadataDrawer, setShowMetadataDrawer] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareExpires, setShareExpires] = useState<string | null>(null)
  const shareLoadIdRef = useRef(0)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Slide size={48} className="mb-4 text-muted-foreground" />
        <p className="text-muted-foreground text-body">Loading analysis...</p>
      </div>
    )
  }

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

  if (status && !status.complete) {
    if (!stuckWarning) {
      return <AnalysisProgress status={status} />
    }
    return (
      <>
        <AnalysisProgress status={status} />
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-[8px] bg-popover border border-border px-6 py-4 text-center shadow-lg dark:shadow-none">
          <p className="text-muted-foreground text-body mb-3">
            This analysis is taking longer than usual.
          </p>
          <button
            type="button"
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
    if (initialLoadFailed) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full text-center">
            <h1 className="text-[30px] font-bold tracking-[-0.015em] text-foreground mb-3">
              Couldn&apos;t Load This Analysis
            </h1>
            <p className="text-muted-foreground text-body mb-6">
              The analysis may still be here — we just couldn&apos;t read it. Try again, and check
              your connection if it keeps failing.
            </p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-block px-4 py-2 rounded-[6px] border border-border text-body font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }
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

  const data = initialData
  const ec: string | null = data.error_code
  const em: string | null = data.error_message

  const summaryRaw = data.summary_json
  const summary = isRecord(summaryRaw)
    ? summaryRaw
    : typeof summaryRaw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(summaryRaw)
            return isRecord(parsed) ? parsed : null
          } catch {
            return null
          }
        })()
      : null

  const shotEvents = getShotEvents({ summary_json: summary })
  const findings = Array.isArray(summary?.findings) ? (summary?.findings as Finding[]) : []
  const focusAreas = Array.isArray(summary?.top_tips)
    ? (summary.top_tips as unknown[]).filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  const strengths = Array.isArray(summary?.strengths)
    ? (summary.strengths as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : []
  const drill = typeof summary?.priority_drill === 'string' ? summary.priority_drill : null
  const narrative = typeof summary?.summary === 'string' ? summary.summary.trim() : ''
  const sessionMetrics = Array.isArray(summary?.session_metrics)
    ? (summary.session_metrics as Array<Record<string, unknown>>).filter(
        (metric) => typeof metric.value === 'number',
      )
    : []
  const proStats =
    summary?.stats && typeof summary.stats === 'object' && !Array.isArray(summary.stats)
      ? (summary.stats as ProfessionalStats)
      : null
  const tacticalSummary = typeof summary?.tactical_summary === 'string' ? summary.tactical_summary : null
  const keyInsights = Array.isArray(summary?.key_insights)
    ? summary.key_insights.filter((insight): insight is string => typeof insight === 'string')
    : []
  const eventCounts = getEventDetectionCounts({ summary_json: summary })
  const confirmedEvents = eventCounts.confirmed
  const candidateEvents = eventCounts.candidate
  const uncertainEvents = eventCounts.uncertain
  const needsReview = Boolean(summary?.needs_review || (isRecord(summary?.quality) && summary?.quality.needs_review))
  const qualityIssues =
    isRecord(summary?.quality) && Array.isArray(summary.quality.issues)
      ? (summary.quality.issues as unknown[]).filter((i): i is string => typeof i === 'string')
      : []
  const failures = Array.isArray(summary?.failures) ? (summary.failures as Array<Record<string, unknown>>) : []
  const failureNotes = failures
    .map((f) => {
      const detail = isRecord(f.detail) ? f.detail : null
      const unseen = Array.isArray(detail?.unseen_candidates) ? detail.unseen_candidates.length : null
      const code = typeof f.code === 'string' ? f.code : null
      const stage = typeof f.stage === 'string' ? f.stage : null
      const retryable = typeof f.retryable === 'boolean' ? (f.retryable ? 'retryable' : 'not retryable') : null
      let message = typeof f.message === 'string' && f.message ? f.message : ''
      if (code === 'F07_MISSED_CANDIDATE' && unseen) {
        message = `${unseen} candidate moment${unseen === 1 ? '' : 's'} not shown for model review${message ? ` — ${message}` : ''}`
      }
      const core = message || code || ''
      const prefix = [code, stage].filter(Boolean).join(' · ')
      return [prefix && core && prefix !== core ? `${prefix}: ${message || core}` : core, retryable].filter(Boolean).join(' · ')
    })
    .filter(Boolean)
  const criteriaRegistry = Array.isArray(summary?.criteria_registry)
    ? (summary.criteria_registry as CriteriaRegistryEntry[]).filter((e) => isRecord(e))
    : []
  const formScore = summaryNumber(summary, 'form_score')
  const averageScore = summaryNumber(summary, 'average_score')
  const confidence = summaryNumber(summary, 'confidence')
  const confidenceKind = typeof summary?.confidence_kind === 'string' ? summary.confidence_kind : null
  const poseConfidence = summaryNumber(summary, 'pose_confidence')
  const successRate = summaryNumber(summary, 'success_rate')
  const composite = isRecord(summary?.composite) ? (summary.composite as Record<string, unknown>) : null
  const compositeScored = typeof composite?.scored_events === 'number' ? composite.scored_events : null
  const compositeConsidered = typeof composite?.considered_events === 'number' ? composite.considered_events : null
  const compositeReason = typeof composite?.reason === 'string' ? composite.reason : null
  const compositeStatus = typeof composite?.status === 'string' ? composite.status : null
  const compositeMethod = typeof composite?.method === 'string' ? composite.method : null
  const confidenceLabel =
    confidenceKind === 'tracking' || confidenceKind === 'pose' ? 'Tracking confidence' : 'Event confidence'
  const confidenceDetail =
    typeof confidence === 'number'
      ? `${confidenceLabel} ${formatConfidencePercent(confidence)}${
          typeof poseConfidence === 'number' &&
          confidenceKind !== 'tracking' &&
          confidenceKind !== 'pose' &&
          Math.abs(poseConfidence - confidence) > 0.01
            ? ` · pose ${formatConfidencePercent(poseConfidence)}`
            : ''
        }`
      : null
  const angle = typeof summary?.angle === 'string' ? summary.angle : null
  const angleSource = typeof summary?.angle_source === 'string' ? summary.angle_source : null
  const scopeNote = typeof summary?.scope_note === 'string' ? summary.scope_note : null
  const recommendedAngles = Array.isArray(summary?.recommended_angles)
    ? (summary.recommended_angles as Array<Record<string, unknown>>)
        .map((a) => {
          const label = typeof a.label === 'string' ? a.label : typeof a.id === 'string' ? a.id : null
          const description = typeof a.description === 'string' ? a.description : null
          if (!label && !description) return null
          return description ? `${label ?? 'Angle'} — ${description}` : (label as string)
        })
        .filter((x): x is string => Boolean(x))
    : []

  const truncateText = (value: string, max = 180) =>
    value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
  const listSummary = (items: string[] | undefined, empty = '—') => {
    if (!items || items.length === 0) return empty
    if (items.length <= 3) return items.join(', ')
    return `${items.slice(0, 3).join(', ')} +${items.length - 3} more`
  }
  const countOrList = (items: string[] | undefined, noun: string) => {
    if (!items || items.length === 0) return `0 ${noun}`
    return `${items.length} ${noun}: ${listSummary(items)}`
  }
  const eventDetection = isRecord(summary?.event_detection) ? (summary.event_detection as Record<string, unknown>) : null
  const eventDetectionSummary = eventDetection
    ? [
        typeof eventDetection.method === 'string' ? `method ${eventDetection.method}` : null,
        typeof eventDetection.validation_status === 'string' ? `validation ${eventDetection.validation_status}` : null,
        typeof eventDetection.rejected === 'number' ? `rejected ${eventDetection.rejected}` : null,
        typeof eventDetection.note === 'string' ? eventDetection.note : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const provenance = isRecord(summary?.provenance) ? (summary.provenance as Record<string, unknown>) : null
  const provenanceSummary = [
    typeof provenance?.engine === 'string' ? `engine ${provenance.engine}` : null,
    typeof provenance?.analysis_prompt === 'string' ? `prompt ${provenance.analysis_prompt}` : null,
    typeof provenance?.analyzed_at === 'string' ? `analyzed ${provenance.analyzed_at}` : null,
    typeof provenance?.sport === 'string' ? `sport ${provenance.sport}` : null,
    typeof provenance?.sport_pack_version === 'number' ? `pack v${provenance.sport_pack_version}` : null,
  ].filter(Boolean).join(' · ')
  const hasProStats = Boolean(proStats || tacticalSummary || keyInsights.length > 0)

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="my-6 pt-4">
        <ol className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <li>
            <Link href="/dashboard/history" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-[2px]">
              History
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted-foreground/60">/</li>
          <li aria-current="page" className="text-foreground truncate max-w-[60ch]">
            {data.display_name || data.file_name || 'Untitled'}
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <AnalysisTitle
            auth0Id={auth0Id}
            jobId={jobId}
            displayName={data.display_name}
            fileName={data.file_name}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
            <span className="tabular-nums">{formatDateTime(data.requested_at)}</span>
            {data.model ? <span>{data.model}</span> : null}
            {data.player_count ? (
              <span className="tabular-nums">
                {data.player_count} player{data.player_count > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={data.complete ? 'green' : ec ? 'red' : 'blue'}>
            {data.complete ? 'Complete' : ec ? 'Failed' : 'In Progress'}
          </StatusPill>
          {needsReview ? (
            <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
              Needs review
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8">
        {!data.complete && !ec ? (
          <HoldToConfirm
            onConfirm={async () => {
              await cancelAnalysis(auth0Id, data.server_job_id)
              router.refresh()
            }}
            confirmLabel="Analysis cancelled"
            aria-label={`Cancel analysis ${data.display_name || data.file_name || 'in progress'}`}
            className="[&_*]:!text-foreground"
          >
            <span className={CHIP_CLASS}>Cancel</span>
          </HoldToConfirm>
        ) : null}
        {data.complete && data.video_ready ? (
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
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setShowMetadataDrawer(true)}>
          View Metadata
        </Button>
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
          aria-label={`Delete analysis ${data.display_name || data.file_name || 'this analysis'}`}
          className="inline-flex items-center rounded-[6px] border border-destructive/30 px-3 py-1.5 text-meta font-medium text-destructive transition-colors hover:bg-destructive/10 [&_*]:!text-foreground"
        >
          Delete
        </HoldToConfirm>

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
              <div className="space-y-2">
                <p className="text-meta text-destructive">{shareError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShareUrl(null)
                    setShareError(null)
                    setShareExpires(null)
                    setShareLoading(true)
                    shareLoadIdRef.current += 1
                    const loadId = shareLoadIdRef.current
                    createShareToken(auth0Id, data.server_job_id)
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
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : shareUrl ? (
              <>
                <div className="flex gap-2">
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
                {shareExpires ? (
                  <p className="text-meta text-muted-foreground tabular-nums">
                    Expires {formatDateTime(shareExpires)}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </Modal>
      </div>

      {pollError && !status?.complete ? (
        <div className="rounded-[6px] border border-warning/30 bg-warning/10 p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-foreground">{pollError}</p>
          <Button variant="outline" size="sm" onClick={() => pollControllerRef.current?.refresh()}>
            Retry now
          </Button>
        </div>
      ) : null}

      {ec ? (
        <div className="rounded-[6px] border border-destructive/20 bg-destructive/10 p-5 mb-8">
          <p className="mb-2 text-meta font-medium text-destructive">Analysis error — {ec}</p>
          <p className="text-body text-muted-foreground">{em || 'The analysis did not complete successfully.'}</p>
        </div>
      ) : null}

      {summary ? (
        <div className="space-y-8">
          <section className="rounded-[6px] border border-border bg-card p-6">
            <CardHeading>Summary & quality</CardHeading>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
                Experimental score
              </span>
              {needsReview ? (
                <span className="rounded-[4px] border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning">
                  Needs review
                </span>
              ) : null}
            </div>
            {narrative ? (
              <p className="text-body leading-[1.7] text-foreground">{narrative}</p>
            ) : (
              <p className="text-body text-muted-foreground">No session summary was produced for this analysis.</p>
            )}
            {scopeNote ? <p className="mt-3 text-meta text-muted-foreground">Scope: {scopeNote}</p> : null}
            {angle ? (
              <p className="mt-2 text-meta text-muted-foreground">
                Angle: {angle}{angleSource ? ` (${angleSource})` : ''}
              </p>
            ) : null}
            {recommendedAngles.length > 0 ? (
              <p className="mt-2 text-meta text-muted-foreground">
                Recommended angles: {recommendedAngles.join(' · ')}
              </p>
            ) : null}
            {qualityIssues.length > 0 ? (
              <p className="mt-3 text-meta text-muted-foreground">Quality notes: {qualityIssues.join('; ')}</p>
            ) : null}
            {failureNotes.length > 0 ? (
              <div className="mt-2 space-y-1">
                {failureNotes.slice(0, 4).map((note, i) => (
                  <p key={i} className="text-meta text-muted-foreground">{note}</p>
                ))}
              </div>
            ) : null}
            {eventDetectionSummary ? (
              <p className="mt-2 text-meta text-muted-foreground">Event detection: {eventDetectionSummary}</p>
            ) : null}
            {criteriaRegistry.length > 0 ? (
              <p className="mt-2 text-meta text-muted-foreground">
                Criteria registry: <span className="tabular-nums">{criteriaRegistry.length}</span> entr{criteriaRegistry.length === 1 ? 'y' : 'ies'} (research context, not validated performance).
              </p>
            ) : null}
            {compositeReason || compositeStatus || compositeMethod ? (
              <p className="mt-2 text-meta text-muted-foreground">
                Composite: {[compositeStatus ? `status ${compositeStatus}` : null, compositeMethod ? `method ${compositeMethod}` : null, compositeReason ? `reason ${compositeReason}` : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                {
                  label: 'Experimental Score',
                  value: formatFormScore(formScore),
                  note:
                    compositeScored !== null && compositeConsidered !== null
                      ? `(${compositeScored} scored / ${compositeConsidered} considered)`
                      : null,
                },
                { label: 'Confidence', value: formatConfidencePercent(confidence), note: confidenceDetail },
                { label: 'Confirmed Events', value: confirmedEvents === null ? '—' : String(confirmedEvents), note: null },
                { label: 'Experimental Average', value: formatAverageScore(averageScore), note: null },
                { label: 'Success Rate', value: formatRatePercent(successRate), note: null },
              ].map((card) => (
                <div key={card.label} className="rounded-[6px] border border-border bg-background p-4">
                  <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">{card.label}</p>
                  <p className="mt-2 font-semibold text-[22px] leading-none tabular-nums text-foreground">{card.value}</p>
                  {card.note ? <p className="mt-1 text-label text-muted-foreground">{card.note}</p> : null}
                </div>
              ))}
            </div>
            <p className="mt-3 text-meta text-muted-foreground">
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
              . Unconfirmed candidates and uncertain detections are not confirmed performance.
            </p>
          </section>

          <section className="rounded-[6px] border border-border bg-card p-6">
            <CardHeading>Video</CardHeading>
            {data.video_ready ? (
              <div className="max-w-4xl mx-auto">
                <VideoPlayer jobId={jobId} summary={summary as unknown as AnalysisSummary} />
              </div>
            ) : (
              <p className="text-body text-muted-foreground">Annotated video is not available for this analysis.</p>
            )}
          </section>

          <section className="rounded-[6px] border border-border bg-card p-6">
            <CardHeading>Evidence & findings</CardHeading>
            {findings.length > 0 ? (
              <FindingsTimeline findings={findings} />
            ) : (
              <p className="text-body text-muted-foreground">No evidence findings were produced for this analysis.</p>
            )}
          </section>

          {criteriaRegistry.length > 0 ? (
            <section className="rounded-[6px] border border-border bg-card p-6">
              <CardHeading>Criteria registry</CardHeading>
              <p className="text-meta text-muted-foreground mb-4">
                Research context: implementation and validation status for assessed criteria. Registry entries describe support, not validated performance.
              </p>
              <div className="space-y-3">
                {criteriaRegistry.map((entry, i) => {
                  const criterionId = typeof entry.criterion_id === 'string' ? entry.criterion_id : null
                  const label = typeof entry.label === 'string' ? entry.label : criterionId ?? 'Criterion'
                  const engineKey = typeof entry.engine_key === 'string' ? entry.engine_key : entry.engine_key === null ? null : null
                  const evidenceType = typeof entry.evidence_type === 'string' ? entry.evidence_type : null
                  const validationStatus = typeof entry.validation_status === 'string' ? entry.validation_status : null
                  const measurementType = typeof entry.measurement_type === 'string' ? entry.measurement_type : null
                  const calibration = typeof entry.calibration === 'string' ? entry.calibration : null
                  const implementation = typeof entry.implementation === 'string' ? entry.implementation : null
                  const qualityGate = typeof entry.quality_gate === 'string' ? entry.quality_gate : null
                  const paperDefinition = typeof entry.paper_definition === 'string' ? entry.paper_definition : null
                  const implementationNote = typeof entry.implementation_note === 'string' ? entry.implementation_note : null
                  const allowedViews = Array.isArray(entry.allowed_views) ? entry.allowed_views.filter((v): v is string => typeof v === 'string') : []
                  const phaseScope = Array.isArray(entry.phase_scope) ? entry.phase_scope.filter((v): v is string => typeof v === 'string') : []
                  const requiredLandmarks = Array.isArray(entry.required_landmarks) ? entry.required_landmarks.filter((v): v is string => typeof v === 'string') : []
                  const requiredObjects = Array.isArray(entry.required_objects) ? entry.required_objects.filter((v): v is string => typeof v === 'string') : []
                  const summaryLine = [
                    criterionId ? `ID ${criterionId}` : null,
                    engineKey ? `engine ${engineKey}` : null,
                    evidenceType ? `evidence ${evidenceType}` : null,
                    validationStatus ? `validation ${validationStatus}` : null,
                    implementation ? `implementation ${implementation}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <details key={criterionId ?? `${label}-${i}`} className="rounded-[6px] border border-border bg-background p-4">
                      <summary className="cursor-pointer list-none">
                        <p className="text-body font-medium text-foreground">{label}</p>
                        {summaryLine ? <p className="mt-1 text-meta text-muted-foreground break-words">{summaryLine}</p> : null}
                      </summary>
                      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-meta sm:grid-cols-2">
                        {measurementType ? (
                          <div>
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Measurement</dt>
                            <dd className="text-foreground mt-0.5 break-words">{measurementType}</dd>
                          </div>
                        ) : null}
                        {calibration ? (
                          <div>
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Calibration</dt>
                            <dd className="text-foreground mt-0.5 break-words">{calibration}</dd>
                          </div>
                        ) : null}
                        {allowedViews.length > 0 ? (
                          <div>
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Allowed views</dt>
                            <dd className="text-foreground mt-0.5 break-words">{listSummary(allowedViews)}</dd>
                          </div>
                        ) : null}
                        {phaseScope.length > 0 ? (
                          <div>
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Phase scope</dt>
                            <dd className="text-foreground mt-0.5 break-words">{listSummary(phaseScope)}</dd>
                          </div>
                        ) : null}
                        {(requiredLandmarks.length > 0 || requiredObjects.length > 0) ? (
                          <div className="sm:col-span-2">
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Requirements</dt>
                            <dd className="text-foreground mt-0.5 break-words">
                              {[
                                requiredLandmarks.length > 0 ? countOrList(requiredLandmarks, 'landmarks') : null,
                                requiredObjects.length > 0 ? countOrList(requiredObjects, 'objects') : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </dd>
                          </div>
                        ) : null}
                        {qualityGate ? (
                          <div className="sm:col-span-2">
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Quality gate</dt>
                            <dd className="text-foreground mt-0.5 break-words">{qualityGate}</dd>
                          </div>
                        ) : null}
                        {paperDefinition ? (
                          <div className="sm:col-span-2">
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Paper definition</dt>
                            <dd className="text-foreground mt-0.5 break-words leading-[1.6]">{truncateText(paperDefinition)}</dd>
                          </div>
                        ) : null}
                        {implementationNote ? (
                          <div className="sm:col-span-2">
                            <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Implementation note</dt>
                            <dd className="text-foreground mt-0.5 break-words leading-[1.6]">{truncateText(implementationNote)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </details>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="rounded-[6px] border border-border bg-card p-6">
            <CardHeading>Key events</CardHeading>
            {shotEvents.length > 0 ? (
              <div className="space-y-3">
                {shotEvents.map((event, i) => {
                  const metrics = eventMetrics(event)
                  const matchup = eventMatchup(event)
                  const eventState = typeof event.event_state === 'string' ? event.event_state : null
                  const eventScore = typeof event.form_score === 'number' ? event.form_score : null
                  return (
                    <div key={i} className="rounded-[6px] border border-border bg-background p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {typeof event.timestamp === 'number' ? <TimestampPill seconds={event.timestamp} /> : null}
                        <span className="text-body font-medium text-foreground capitalize">
                          {typeof event.event_type === 'string' ? event.event_type.replace(/_/g, ' ') : 'Event'}
                        </span>
                        {eventStateBadgeLabel(eventState) ? (
                          <span className="text-label font-medium px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                            {eventStateBadgeLabel(eventState)}
                          </span>
                        ) : (
                          <span className="text-label font-medium px-2 py-0.5 rounded-full bg-accent text-muted-foreground">confirmed</span>
                        )}
                        <span className="text-label font-medium px-2 py-0.5 rounded-full bg-accent text-muted-foreground">
                          Score: <span className="tabular-nums">{formatFormScore(eventScore)}</span>
                        </span>
                      </div>
                      {typeof event.key_observation === 'string' && event.key_observation ? (
                        <p className="text-body text-foreground mb-1">{event.key_observation}</p>
                      ) : null}
                      {typeof event.feedback === 'string' && event.feedback ? (
                        <p className="text-meta text-muted-foreground">{event.feedback}</p>
                      ) : null}
                      {metrics.length > 0 && !(matchup?.primary?.metrics?.length) ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          {metrics
                            .filter((metric) => typeof metric.value === 'number')
                            .slice(0, 3)
                            .map((metric) => (
                              <span key={metric.key} className="text-label text-muted-foreground">
                                {metric.label}{' '}
                                <span className="tabular-nums text-foreground">
                                  {formatMetric(metric.value as number, metric.unit)}
                                </span>
                              </span>
                            ))}
                        </div>
                      ) : null}
                      {matchup ? (
                        <div className="mt-3 rounded-[6px] border border-border bg-card p-3">
                          {matchup.primary?.tracked === false ? (
                            <p className="mb-2 text-label text-muted-foreground">
                              Primary athlete not reliably tracked for this matchup; matchup values may be limited.
                            </p>
                          ) : null}
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              { key: 'primary', role: matchup.primary },
                              { key: 'opponent', role: matchup.opponent },
                            ].map(({ key, role }) =>
                              role ? (
                                <div key={key}>
                                  <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">{role.role}</p>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                    {(role.metrics ?? [])
                                      .filter((metric) => typeof metric.value === 'number')
                                      .slice(0, 3)
                                      .map((metric) => (
                                        <span key={metric.key} className="text-label text-muted-foreground">
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
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-body text-muted-foreground">No key events were detected. This can happen when events are unclear or not confirmed.</p>
            )}
          </section>

          <section className="rounded-[6px] border border-border bg-card p-6">
            <CardHeading>Measured performance & stats</CardHeading>
            {sessionMetrics.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 mb-6">
                {sessionMetrics.map((metric) => {
                  const value = metric.value as number
                  const unit = typeof metric.unit === 'string' ? metric.unit : ''
                  const best = typeof metric.best === 'number' ? metric.best : null
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
            {hasProStats ? (
              <ProStatsPanel stats={proStats} tacticalSummary={tacticalSummary} keyInsights={keyInsights} />
            ) : null}
            {sessionMetrics.length === 0 && !hasProStats ? (
              <p className="text-body text-muted-foreground">No measured metrics or professional stats are available for this analysis.</p>
            ) : null}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-[6px] border border-border bg-card p-6">
              <CardHeading>Strengths</CardHeading>
              {strengths.length > 0 ? (
                <ul className="space-y-2">
                  {strengths.map((s, i) => (
                    <li key={i} className="text-body text-foreground flex items-start gap-2">
                      <span className="text-success shrink-0">✓</span>{s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">No strengths were identified for this analysis.</p>
              )}
            </div>
            <div className="rounded-[6px] border border-border bg-card p-6">
              <CardHeading>Focus areas & drill</CardHeading>
              {focusAreas.length > 0 ? (
                <ul className="space-y-2 mb-4">
                  {focusAreas.map((tip, i) => (
                    <li key={i} className="text-body text-foreground flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0 tabular-nums">{i + 1}.</span>{tip}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground mb-4">No specific focus areas were produced.</p>
              )}
              <div className="rounded-[6px] border border-border bg-background p-4">
                <p className="text-meta font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">Recommended drill</p>
                {drill ? (
                  <p className="text-body text-foreground">{drill}</p>
                ) : (
                  <p className="text-body text-muted-foreground">No drill recommendation available.</p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[6px] border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div>
                <h2 className="text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">Chat with AI Coach</h2>
                <p className="text-meta text-muted-foreground mt-0.5">
                  Ask questions about evidence, findings, and recommendations. Scores shown are experimental.
                </p>
              </div>
              <Link href={`/dashboard/analysis/${jobId}/chat`} className="text-meta font-medium text-primary hover:underline">
                Full screen →
              </Link>
            </div>
            <div className="rounded-[6px] border border-border bg-background overflow-hidden" style={{ height: 'min(500px, 60vh)' }}>
              <HistoryChat auth0Id={auth0Id} jobId={jobId} summary={summary} />
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-[6px] border border-border bg-card p-6">
          <p className="text-body text-muted-foreground">
            {data.complete
              ? 'This analysis completed without a readable summary.'
              : 'Summary is not available yet for this analysis.'}
          </p>
        </div>
      )}

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
              <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Job ID</dt>
              <dd className="text-foreground font-mono text-meta break-all mt-1">{data.engine_job_id}</dd>
            </div>
            {data.session_token ? (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Session Token</dt>
                <dd className="text-foreground font-mono text-meta break-all mt-1">{data.session_token}</dd>
              </div>
            ) : null}
            {data.completed_at ? (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Completed</dt>
                <dd className="text-foreground mt-1 tabular-nums">{formatDateTime(data.completed_at)}</dd>
              </div>
            ) : null}
            {data.download_count > 0 ? (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Downloads</dt>
                <dd className="text-foreground mt-1 tabular-nums">{data.download_count}</dd>
              </div>
            ) : null}
            {provenanceSummary ? (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Provenance</dt>
                <dd className="text-foreground mt-1 text-meta leading-[1.5]">{provenanceSummary}</dd>
              </div>
            ) : null}
            {(angle || scopeNote) ? (
              <div>
                <dt className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">Context</dt>
                <dd className="text-foreground mt-1 text-meta leading-[1.5]">
                  {[angle ? `Angle ${angle}${angleSource ? ` (${angleSource})` : ''}` : null, scopeNote ? `Scope: ${scopeNote}` : null].filter(Boolean).join(' · ')}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </Drawer>
    </div>
  )
}
