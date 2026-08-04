'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import AnalysisTitle from '@/components/AnalysisTitle'
import AnalysisProgress from '@/components/AnalysisProgress'
import ErrorScreen from '@/components/ErrorScreen'
import ResultsSummary from '@/components/ResultsSummary'
import HistoryChat from '@/components/HistoryChat'
import { getJobStatus, getDownloadUrl } from '@/lib/api'
import type { JobStatus } from '@/types'
import type { DashboardAnalysis } from '@/lib/api'

const POLL_INTERVAL = 2000
const MAX_POLL_RETRIES = 3

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasPolledSuccessfully = useRef(false)
  const pollRetryCount = useRef(0)
  const pollStartTime = useRef<number>(Date.now())

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const s = await getJobStatus(jobId)
        if (cancelled) return
        setStatus(s)
        setLoading(false)
        hasPolledSuccessfully.current = true
        pollRetryCount.current = 0
        setPollError(null)
        if (s.complete) {
          if (s.error_code === 'JOB_NOT_FOUND') {
            setExpiredMessage(s.error ?? 'Analysis not found or expired.')
          }
          stopPolling()
        } else if (!stuckWarning && Date.now() - pollStartTime.current > 5 * 60 * 1000) {
          setStuckWarning(true)
        }
      } catch (err) {
        if (cancelled) return
        setLoading(false)
        
        // Distinguish between transient errors and permanent failures
        const errorMessage = err instanceof Error ? err.message : String(err)
        const isTransient = errorMessage.includes('network') || 
                           errorMessage.includes('timeout') ||
                           errorMessage.includes('fetch')
        
        if (!hasPolledSuccessfully.current) {
          // Never polled successfully - treat as expired
          setExpiredMessage('Analysis not found or expired.')
          stopPolling()
        } else if (isTransient && pollRetryCount.current < MAX_POLL_RETRIES) {
          // Transient error - retry without stopping
          pollRetryCount.current++
          setPollError(`Connection issue. Retrying... (${pollRetryCount.current}/${MAX_POLL_RETRIES})`)
        } else {
          // Permanent failure or max retries exceeded
          setPollError('Unable to update status. Please refresh the page.')
          stopPolling()
        }
      }
    }

    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL)

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [jobId, stopPolling])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-(--cream-10) border-t-(--fg) rounded-full animate-spin mb-4" />
        <p className="text-(--cream-40) text-sm">Loading analysis...</p>
      </div>
    )
  }

  // ── Expired / Not Found ──────────────────────────────────────────────────
  if (expiredMessage) {
    return (
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <svg className="w-16 h-16 mx-auto mb-6 text-(--cream-20)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h1 className="text-2xl font-semibold text-(--fg) mb-3">Analysis Expired</h1>
          <p className="text-(--cream-40) mb-6">{expiredMessage}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 border border-(--cream-10) text-(--cream-40) text-sm uppercase tracking-[0.15em] hover:text-(--fg) hover:border-(--cream-20) transition-colors"
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
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 border-4 border-(--cream-10) border-t-(--fg) rounded-full animate-spin mb-4" />
          <p className="text-(--cream-40) text-sm mb-2">Loading analysis...</p>
          <p className="text-(--red) text-xs">{pollError}</p>
        </div>
      </div>
    )
  }

  // ── In Progress: analyzing / rendering / scanning / player_selection ──────
  if (status && !status.complete) {
    if (!stuckWarning) {
      return <AnalysisProgress status={status} />
    }
    // Show stuck warning below the progress view
    return (
      <>
        <AnalysisProgress status={status} />
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-(--bg) border border-(--cream-10) px-6 py-4 text-center shadow-lg">
          <p className="text-(--cream-40) text-sm mb-3">
            This analysis is taking longer than usual.
          </p>
          <button
            onClick={async () => {
              try {
                const s = await getJobStatus(jobId)
                setStatus(s)
                if (s.complete) {
                  stopPolling()
                  if (s.error_code === 'JOB_NOT_FOUND') {
                    setExpiredMessage(s.error ?? 'Analysis not found or expired.')
                  }
                } else {
                  setStuckWarning(false)
                  pollStartTime.current = Date.now()
                }
              } catch {
                setPollError('Unable to refresh status. Please try again.')
              }
            }}
            className="px-4 py-2 border border-(--cream-10) text-(--cream-40) text-[0.65rem] uppercase tracking-[0.15em] hover:text-(--fg) hover:border-(--cream-20) transition-colors"
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
      <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-(--fg) mb-3">Analysis Expired</h1>
          <p className="text-(--cream-40) mb-6">Analysis not found or expired.</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 border border-(--cream-10) text-(--cream-40) text-sm uppercase tracking-[0.15em] hover:text-(--fg) hover:border-(--cream-20) transition-colors"
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
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="flex items-center gap-2 mb-8 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
        <Link href="/dashboard" className="hover:text-(--fg) transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/dashboard/history" className="hover:text-(--fg) transition-colors">
          History
        </Link>
        <span>/</span>
        <span className="text-(--fg)">{data.engine_job_id.slice(0, 8)}</span>
      </div>

      <div className="flex items-start justify-between mb-12">
        <div>
          <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Analysis Detail
          </p>
          <AnalysisTitle auth0Id={auth0Id} jobId={jobId} displayName={data.display_name} fileName={data.file_name} />
          <div className="mt-4 flex items-center gap-4 text-[0.65rem] text-(--cream-40)">
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
          className={`text-[0.6rem] uppercase tracking-[0.15em] px-3 py-1.5 border ${
            data.complete
              ? 'border-(--cream-10) text-(--cream-40)'
              : ec
                ? 'border-(--red) text-(--red)'
                : 'border-(--cream-20) text-(--cream-20)'
          }`}
        >
          {data.complete ? 'Complete' : ec ? 'Failed' : 'In Progress'}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-8">
        {data.complete && data.video_ready && (
          <a
            href={getDownloadUrl(data.server_job_id)}
            className="px-4 py-2 border border-(--cream-10) text-(--cream-40) text-[0.65rem] uppercase tracking-[0.15em] hover:text-(--fg) hover:border-(--cream-20) transition-colors"
          >
            Download Video
          </a>
        )}
      </div>

      {ec && (
        <div className="border border-(--red) p-8 mb-8">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--red) mb-4">
            Error — {ec}
          </p>
          <p className="text-sm text-(--cream-40)">{em}</p>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-(--cream-05) mb-8">
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
            <div key={card.label} className="bg-(--bg) p-6">
              <p className="font-serif text-3xl text-(--fg)">{card.value}</p>
              <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
                {card.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {summary && 'shot_events' in summary && Array.isArray(summary.shot_events) && (
        <div className="border border-(--cream-10) p-8 mb-8">
          <p className="mb-6 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Shot Events
          </p>
          <div className="space-y-0">
            {(summary.shot_events as Array<Record<string, unknown>>).map((event, i) => (
              <div
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < (summary.shot_events as unknown[]).length - 1
                    ? 'border-b border-(--cream-05)'
                    : ''
                }`}
              >
                {typeof event.timestamp === 'number' && (
                  <span className="font-mono text-xs text-(--cream-40) tabular-nums w-16 shrink-0">
                    {Math.floor(event.timestamp / 60)}:
                    {String(Math.round(event.timestamp % 60)).padStart(2, '0')}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-(--fg)">
                      {typeof event.event_type === 'string' ? event.event_type : 'Event'}
                    </p>
                    {typeof event.form_score === 'number' && (
                      <span className={`text-xs px-1.5 py-0.5 ${
                        event.form_score >= 8 ? 'text-(--fg) bg-(--cream-05)' :
                        event.form_score >= 5 ? 'text-amber-400 bg-amber-500/10' :
                        'text-red-400 bg-red-500/10'
                      }`}>
                        {event.form_score}/10
                      </span>
                    )}
                  </div>
                  {typeof event.feedback === 'string' && (
                    <p className="mt-1 text-xs text-(--cream-40)">{event.feedback}</p>
                  )}
                  {typeof event.key_observation === 'string' && (
                    <p className="mt-0.5 text-xs text-(--cream-20)">{event.key_observation}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-(--cream-05) mb-8">
          {'top_tips' in summary && Array.isArray(summary.top_tips) && (summary.top_tips as string[]).length > 0 && (
            <div className="bg-(--bg) p-8">
              <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">Priority Focus</p>
              <ul className="space-y-2">
                {(summary.top_tips as string[]).map((tip, i) => (
                  <li key={i} className="text-sm text-(--fg) flex items-start gap-2">
                    <span className="text-(--cream-40) shrink-0">{i + 1}.</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {'strengths' in summary && Array.isArray(summary.strengths) && (summary.strengths as string[]).length > 0 && (
            <div className="bg-(--bg) p-8">
              <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">Strengths</p>
              <ul className="space-y-2">
                {(summary.strengths as string[]).map((s, i) => (
                  <li key={i} className="text-sm text-(--fg) flex items-start gap-2">
                    <span className="text-green-400 shrink-0">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {drill && (
        <div className="border border-(--cream-10) p-8 mb-8">
          <p className="mb-2 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">Recommended Drill</p>
          <p className="text-sm text-(--fg)">{drill}</p>
        </div>
      )}

      <div className="border border-(--cream-10) p-8">
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
          Metadata
        </p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) mb-1">
              Job ID
            </dt>
            <dd className="text-(--fg) font-mono text-xs break-all">{data.engine_job_id}</dd>
          </div>
          {data.session_token && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) mb-1">
                Session Token
              </dt>
              <dd className="text-(--fg) font-mono text-xs break-all">{data.session_token}</dd>
            </div>
          )}
          {data.completed_at && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) mb-1">
                Completed
              </dt>
              <dd className="text-(--fg)">
                {new Date(data.completed_at).toLocaleString()}
              </dd>
            </div>
          )}
          {data.download_count > 0 && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) mb-1">
                Downloads
              </dt>
              <dd className="text-(--fg)">{data.download_count}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Only show chat when the analysis actually completed with a summary.
          Failed analyses have no context for the AI to answer questions about. */}
      {summary && (
        <div className="mt-8">
          <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Chat with AI
          </p>
          <div className="border border-(--cream-10)" style={{ height: 'min(500px, 60vh)' }}>
            <HistoryChat auth0Id={auth0Id} jobId={jobId} summary={summary} />
          </div>
        </div>
      )}
    </div>
  )
}
