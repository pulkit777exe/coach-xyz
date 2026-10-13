// ── Analysis detail state ──────────────────────────────────────────────────
// One home for AnalysisDetailClient's async orchestration: job-status
// polling (status/loading/expired/poll-error/stuck states), share-link
// minting with its race guard, and the authorized media URL. The component
// keeps view states (active view, dialogs, drawers), branch JSX, and nav
// glue (router pushes after cancel/delete).

import { useEffect, useRef, useState } from 'react'

import { getJobStatus } from './scan'
import { createShareToken } from './aiReports'
import { startJobPolling, type JobPollingController } from './jobPolling'
import { useAuthorizedMediaUrl } from './useAuthorizedMediaUrl'
import type { JobStatus, CoachAIError } from '@/types'
import type { DashboardAnalysis } from './library'

const POLL_INTERVAL = 2000
const MAX_POLL_RETRIES = 3
const STUCK_WARNING_MS = 5 * 60 * 1000

export function useAnalysisDetailState(opts: {
  auth0Id: string
  jobId: string
  initialData: DashboardAnalysis | null
  shareOpen: boolean
}) {
  const { auth0Id, jobId, initialData, shareOpen } = opts
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [stuckWarning, setStuckWarning] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareExpires, setShareExpires] = useState<string | null>(null)
  const shareLoadIdRef = useRef(0)
  const pollControllerRef = useRef<JobPollingController | null>(null)
  const downloadUrl = useAuthorizedMediaUrl(jobId)

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

  // Create the share token once the share modal opens; the link is minted per
  // analysis and expires after a fixed window (72h on the server).
  useEffect(() => {
    if (!shareOpen || !initialData) return
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
  }, [shareOpen, auth0Id, initialData])

  const dismissStuckWarning = () => {
    setStuckWarning(false)
    pollControllerRef.current?.refresh()
  }

  /** Reset share state and mark a load in flight (called with the modal open). */
  const beginShare = () => {
    setShareUrl(null)
    setShareError(null)
    setShareExpires(null)
    setShareLoading(true)
  }

  return {
    status,
    loading,
    expiredMessage,
    pollError,
    stuckWarning,
    dismissStuckWarning,
    downloadUrl,
    shareUrl,
    shareLoading,
    shareError,
    shareExpires,
    beginShare,
  }
}
