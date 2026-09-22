'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import { toCoachAIError } from '@/lib/errors'
import { startJobPolling, type JobPollingController } from '@/lib/jobPolling'
import { mapEngineStateToPipeline } from '@/lib/pipelineState'
import { useScanFlow } from '@/lib/useScanFlow'
import type { PipelineState, ScanResult, JobStatus, UploadProgress } from '@/types'

export interface PipelineActions {
  handleFileSelected: (file: File) => void
  handlePlayerSelected: (playerIndex: number) => void
  /** Upload another camera perspective into the current session. */
  handleAddAngle: (file: File, angle: string) => void
  /** Switch the selecting view between scanned perspectives. */
  handleAngleChange: (angle: string) => void
  handleRetry: () => void
  handleReset: () => void
  handleStartChat: () => void
  handleBackToResults: () => void
}

export interface Pipeline extends PipelineActions {
  pipelineState: PipelineState
  scanResult: ScanResult | null
  /** Every scanned perspective in this session (primary first). */
  angleScans: ScanResult[]
  /** Currently selected perspective label. */
  activeAngle: string
  selectedPlayerIndex: number | null
  jobId: string | null
  jobStatus: JobStatus | null
  errorStatus: CoachAIError | null
  uploadProgress: UploadProgress | null
}

const BASE = process.env.NEXT_PUBLIC_API_URL

export function usePipeline(auth0Id: string | null = null, initialJobId: string | null = null): Pipeline {
  const router = useRouter()
  const pathname = usePathname()
  // Job-phase state, owned by the poll loop / resume / retry below. Null
  // means "follow the scan flow": the derived pipelineState mirrors the
  // flow phase (idle → uploading → scanning → selecting → analyzing/error).
  // This keeps one source of truth per phase instead of syncing two states
  // in an effect.
  const [jobPhase, setJobPhase] = useState<PipelineState | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [jobError, setJobError] = useState<CoachAIError | null>(null)

  const retryGenerationRef = useRef(0)

  // ── Keep-alive ping ────────────────────────────────────────────────────
  useEffect(() => {
    if (!BASE) return
    const ping = () => fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────
  const pollControllerRef = useRef<JobPollingController | null>(null)

  const stopPolling = useCallback(() => {
    pollControllerRef.current?.stop()
    pollControllerRef.current = null
  }, [])

  const startPolling = useCallback(
    (pollJobId: string) => {
      stopPolling()
      pollControllerRef.current = startJobPolling({
        jobId: pollJobId,
        fetchStatus: getJobStatus,
        isComplete: (status) => status.complete,
        intervalMs: 2000,
        timeoutMs: 12 * 60 * 1000,
        maxFailures: 5,
        // Job still in progress — safe to update status and stage display.
        // Cap the displayed progress at 99 while the job is not yet
        // complete, so the bar never reaches 100% on the loading screen.
        onStatus: (status) => {
          const displayStatus = status.progress >= 100
            ? { ...status, progress: 99 }
            : status
          setJobStatus(displayStatus)
          if (status.state) {
            setJobPhase(mapEngineStateToPipeline(status.state))
          }
        },
        onComplete: (status) => {
          if (status.error) {
            // Store the error status first, then flip pipeline state.
            // Never store a complete/100% jobStatus while still on the
            // progress screen — that's what causes the 100% flash.
            setJobError({
              code: status.error_code ?? 'ANALYSIS_FAILED',
              message: status.error,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setJobPhase('error')
          } else {
            // Flip pipeline state BEFORE writing jobStatus so that
            // AnalysisProgress never receives a status with progress=100.
            // React batches these two setState calls in the same render.
            setJobPhase('completed')
            setJobStatus(status)
          }
        },
        onError: (failure) => {
          setJobError(failure.error)
          setJobPhase('error')
        },
      })
    },
    [stopPolling],
  )

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // ── Resume from initialJobId ────────────────────────────────────────────
  useEffect(() => {
    if (!initialJobId) return
    let cancelled = false

    const resume = async () => {
      try {
        const status = await getJobStatus(initialJobId)
        if (cancelled) return
        setJobId(initialJobId)
        if (status.complete) {
          if (status.error) {
            setJobError({
              code: status.error_code ?? 'ANALYSIS_FAILED',
              message: status.error,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setJobPhase('error')
          } else {
            setJobPhase('completed')
            setJobStatus(status)
          }
        } else {
          // Job still in progress — resume polling
          setJobStatus(status)
          if (status.state) {
            setJobPhase(mapEngineStateToPipeline(status.state))
          }
          startPolling(initialJobId)
        }
      } catch {
        if (cancelled) return
        setJobError({
          code: 'JOB_NOT_FOUND',
          message: 'Could not resume analysis. It may have expired.',
          layer: 'client',
          retryable: false,
        })
        setJobPhase('error')
      }
    }

    resume()
    return () => { cancelled = true }
  }, [initialJobId, startPolling])

  /** Kick off analysis for one scanned perspective + player. */
  const startAnalysisForScan = useCallback(
    async (scan: ScanResult, playerIndex: number) => {
      const { job_id } = await startAnalysis({
        session_token: scan.session_token,
        player_index: playerIndex,
        video_key: scan.video_key,
        angle: scan.angle ?? null,
        auth0Id,
      })
      setJobId(job_id)
      startPolling(job_id)
      if (pathname !== `/dashboard/analysis/${job_id}`) {
        router.push(`/dashboard/analysis/${job_id}`)
      }
    },
    [auth0Id, startPolling, router, pathname],
  )

  // ── Shared scan flow ───────────────────────────────────────────────────
  // Scan-phase state (upload → SSE → select → angles) lives in useScanFlow;
  // this hook owns job-phase state (polling, resume, retry, navigation).
  const flow = useScanFlow({ auth0Id, onAnalyze: startAnalysisForScan })

  // Derived pipeline state: the poll loop owns analyzing/rendering/completed
  // (jobPhase set), otherwise the scan flow phase shows through. Scan errors
  // surface from the flow; job errors from the poll loop.
  const pipelineState: PipelineState =
    jobPhase ?? (flow.phase === 'error' ? 'error' : flow.phase)
  const errorStatus: CoachAIError | null = jobError ?? flow.errorStatus

  // Keep a ref of the derived state for the retry generation guard.
  const pipelineStateRef = useRef<PipelineState>(pipelineState)
  useEffect(() => {
    pipelineStateRef.current = pipelineState
  }, [pipelineState])

  const handleRetry = useCallback(() => {
    stopPolling()

    if (flow.scanResult && errorStatus?.retryable && errorStatus?.layer !== 'client') {
      setJobStatus(null)
      setJobError(null)

      if (flow.selectedPlayerIndex !== null) {
        setJobPhase('analyzing')
        const gen = ++retryGenerationRef.current
        const scan = flow.scanResult
        const playerIndex = flow.selectedPlayerIndex
        startAnalysis({
          session_token: scan.session_token,
          player_index: playerIndex,
          video_key: scan.video_key,
          angle: scan.angle ?? null,
          auth0Id,
        })
          .then(({ job_id }) => {
            // Don't start polling if pipeline was reset or another retry started
            if (pipelineStateRef.current === 'idle' || retryGenerationRef.current !== gen) return
            setJobId(job_id)
            startPolling(job_id)
            if (pathname !== `/dashboard/analysis/${job_id}`) {
              router.push(`/dashboard/analysis/${job_id}`)
            }
          })
          .catch((e: unknown) => {
            if (retryGenerationRef.current !== gen) return
            setJobError(toCoachAIError(e))
            setJobPhase('error')
          })
      } else {
        flow.revive()
      }
    } else {
      flow.reset()
      setJobId(null)
      setJobStatus(null)
      setJobError(null)
      setJobPhase(null)
    }
  }, [
    flow,
    errorStatus,
    stopPolling,
    startPolling,
    auth0Id,
    router,
    pathname,
  ])

  const handleReset = useCallback(() => {
    stopPolling()
    flow.reset()
    setJobId(null)
    setJobStatus(null)
    setJobError(null)
    setJobPhase(null)
  }, [stopPolling, flow])

  const handleStartChat = useCallback(() => {
    setJobPhase('chatting')
  }, [])

  const handleBackToResults = useCallback(() => {
    setJobPhase('completed')
  }, [])

  return {
    pipelineState,
    scanResult: flow.scanResult,
    angleScans: flow.angleScans,
    activeAngle: flow.activeAngle,
    selectedPlayerIndex: flow.selectedPlayerIndex,
    jobId,
    jobStatus,
    errorStatus,
    uploadProgress: flow.uploadProgress,
    handleFileSelected: flow.handleFileSelected,
    handlePlayerSelected: flow.handlePlayerSelected,
    handleAddAngle: flow.handleAddAngle,
    handleAngleChange: flow.handleAngleChange,
    handleRetry,
    handleReset,
    handleStartChat,
    handleBackToResults,
  }
}
