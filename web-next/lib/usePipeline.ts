'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { startAnalysis, getJobStatus } from '@/lib/scan'
import type { CoachAIError } from '@/types'
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
  /** XState-inspired snapshot: one read-model for every renderer. */
  snapshot: PipelineSnapshot
  /** XState-inspired sender: one entry point for every pipeline event. */
  send: (event: PipelineEvent) => void
}

// ── Unified pipeline machine (XState actor-inspired) ─────────────────────────
// One entry (usePipeline), snapshot out, events in, differences injected.
// The scan phase lives in useScanFlow (validate → upload → SSE → select);
// this module owns the job phase (poll → complete/error → retry) and the
// single retry branch / 99-cap / poll config shared by coach + player.
// Callers differ only by injected services:
//   - startAnalysisImpl: coach (lib/api startAnalysis) vs player (meStartAnalysis)
//   - navigate: coach pushes to /dashboard/analysis/:jobId; player omits it
//   - notify/onCompleted: player toasts + refreshes; coach omits them
// Like jobPolling's clock/fetch/callbacks, fetchStatus/now are injectable so
// the transition table stays deterministic and testable (no live I/O).

/** Single poll config for every job-status consumer in this pipeline. */
export const PIPELINE_POLL = {
  intervalMs: 2000,
  timeoutMs: 12 * 60 * 1000,
  maxFailures: 5,
} as const

/** Single displayed-progress cap: the bar never hits 100% before completion. */
export function capPipelineProgress(progress: number): number {
  return Math.min(progress, 99)
}

/** Single retry branch: re-kickoff vs revive-vs-reset. */
export type RetryDecision = 'rekickoff' | 'revive' | 'reset'

export function decideRetryAction(input: {
  error: CoachAIError | null
  scanResult: ScanResult | null
  selectedPlayerIndex: number | null
}): RetryDecision {
  const { error, scanResult, selectedPlayerIndex } = input
  if (error?.retryable && error?.layer !== 'client' && scanResult) {
    return selectedPlayerIndex !== null ? 'rekickoff' : 'revive'
  }
  return 'reset'
}

/** Generation guard for async re-kickoff: drop stale kickoffs after reset/retry. */
export function shouldApplyRekickoff(
  capturedGeneration: number,
  currentGeneration: number,
  phase: PipelineState,
): boolean {
  return capturedGeneration === currentGeneration && phase !== 'idle'
}

/** Minimal read-model: phase, capped progress, scan, job, error. */
export interface PipelineSnapshot {
  phase: PipelineState
  /** Displayed progress, always capped at 99 (see capPipelineProgress). */
  progress: number
  scanResult: ScanResult | null
  job: { id: string | null; status: JobStatus | null }
  error: CoachAIError | null
}

/**
 * Pipeline events. `angle` covers both angle writes (addAngle: file+angle)
 * and angle reads (angleChange); `chat` covers start, `back` returns to results.
 */
export type PipelineEvent =
  | { type: 'file'; file: File }
  | { type: 'addAngle'; file: File; angle: string }
  | { type: 'angleChange'; angle: string }
  | { type: 'player'; index: number }
  | { type: 'retry' }
  | { type: 'reset' }
  | { type: 'chat' }
  | { type: 'back' }

export interface PipelineNotify {
  success?: (message: string) => void
  error?: (code: string, message: string) => void
}

/** Injected differences between coach + player (all optional). */
export interface PipelineServices {
  /** Kickoff variant: coach startAnalysis vs player meStartAnalysis. */
  startAnalysisImpl?: (scan: ScanResult, playerIndex: number) => Promise<{ job_id: string }>
  /** Coach navigates to the analysis page; omit for the player card. */
  navigate?: (jobId: string) => void
  /** Player toasts; coach omits (renders ErrorScreen instead). */
  notify?: PipelineNotify
  /** Injectable fetcher/clock for deterministic tests (defaults: live). */
  fetchStatus?: (jobId: string) => Promise<JobStatus>
  now?: () => number
  /** Player refreshes its analyses list on completion; coach omits. */
  onCompleted?: () => void
}

const BASE = process.env.NEXT_PUBLIC_API_URL

export function usePipeline(
  auth0Id: string | null = null,
  initialJobId: string | null = null,
  overrides?: PipelineServices,
): Pipeline {
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
  const lastNotifyKeyRef = useRef<string | null>(null)

  // Latest-notify refs keep startPolling stable while still calling the
  // newest toast/refresh callbacks (player memoizes them; coach omits them).
  const notifyRef = useRef<PipelineNotify | undefined>(overrides?.notify)
  useEffect(() => {
    notifyRef.current = overrides?.notify
  }, [overrides?.notify])
  const onCompletedRef = useRef<(() => void) | undefined>(overrides?.onCompleted)
  useEffect(() => {
    onCompletedRef.current = overrides?.onCompleted
  }, [overrides?.onCompleted])

  const notifyErrorOnce = useCallback((code: string, message: string) => {
    const key = `${code}:${message}`
    if (lastNotifyKeyRef.current === key) return
    lastNotifyKeyRef.current = key
    notifyRef.current?.error?.(code, message)
  }, [])

  // ── Keep-alive ping ────────────────────────────────────────────────────
  useEffect(() => {
    if (!BASE) return
    const ping = () =>
      fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
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

  const fetchStatusImpl = overrides?.fetchStatus ?? getJobStatus
  const clockNow = overrides?.now ?? Date.now

  const startPolling = useCallback(
    (pollJobId: string) => {
      stopPolling()
      pollControllerRef.current = startJobPolling({
        jobId: pollJobId,
        fetchStatus: fetchStatusImpl,
        isComplete: (status) => status.complete,
        intervalMs: PIPELINE_POLL.intervalMs,
        timeoutMs: PIPELINE_POLL.timeoutMs,
        maxFailures: PIPELINE_POLL.maxFailures,
        now: clockNow,
        // Job still in progress — safe to update status and stage display.
        // Cap the displayed progress at 99 while the job is not yet
        // complete, so the bar never reaches 100% on the loading screen.
        onStatus: (status) => {
          setJobStatus({ ...status, progress: capPipelineProgress(status.progress) })
          if (status.state) {
            setJobPhase(mapEngineStateToPipeline(status.state))
          }
        },
        onComplete: (status) => {
          if (status.error) {
            const code = status.error_code ?? 'ANALYSIS_FAILED'
            const message = status.error
            // Store the error status first, then flip pipeline state.
            // Never store a complete/100% jobStatus while still on the
            // progress screen — that's what causes the 100% flash.
            setJobError({
              code,
              message,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setJobPhase('error')
            notifyErrorOnce(code, message)
          } else {
            // Flip pipeline state BEFORE writing jobStatus so that
            // AnalysisProgress never receives a status with progress=100.
            // React batches these two setState calls in the same render.
            setJobPhase('completed')
            setJobStatus(status)
            notifyRef.current?.success?.('Analysis complete — check your analyses below.')
            onCompletedRef.current?.()
          }
        },
        onError: (failure) => {
          setJobError(failure.error)
          setJobPhase('error')
          notifyErrorOnce(failure.error.code, failure.error.message)
        },
      })
    },
    [stopPolling, fetchStatusImpl, clockNow, notifyErrorOnce],
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
        const status = await fetchStatusImpl(initialJobId)
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
          // Job still in progress — resume polling (cap the first paint too).
          setJobStatus({ ...status, progress: capPipelineProgress(status.progress) })
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
    return () => {
      cancelled = true
    }
  }, [initialJobId, startPolling, fetchStatusImpl])

  // ── Injected differences ───────────────────────────────────────────────
  const customNavigate = overrides?.navigate
  const hasOverrides = overrides !== undefined
  const navigateToAnalysis = useCallback(
    (navigateJobId: string) => {
      if (customNavigate) {
        customNavigate(navigateJobId)
      } else if (!hasOverrides) {
        // Coach default (backward compat). The player card passes overrides
        // without navigate, so coach semantics never leak onto it.
        if (pathname !== `/dashboard/analysis/${navigateJobId}`) {
          router.push(`/dashboard/analysis/${navigateJobId}`)
        }
      }
    },
    [customNavigate, hasOverrides, router, pathname],
  )

  const defaultStartAnalysis = useCallback(
    (scan: ScanResult, playerIndex: number) =>
      startAnalysis({
        session_token: scan.session_token,
        player_index: playerIndex,
        video_key: scan.video_key,
        angle: scan.angle ?? null,
        auth0Id,
      }),
    [auth0Id],
  )
  const startAnalysisImpl = overrides?.startAnalysisImpl ?? defaultStartAnalysis

  /** Kick off analysis for one scanned perspective + player. */
  const startAnalysisForScan = useCallback(
    async (scan: ScanResult, playerIndex: number) => {
      const { job_id } = await startAnalysisImpl(scan, playerIndex)
      setJobId(job_id)
      startPolling(job_id)
      navigateToAnalysis(job_id)
    },
    [startAnalysisImpl, startPolling, navigateToAnalysis],
  )

  // ── Shared scan flow ───────────────────────────────────────────────────
  // Scan-phase state (upload → SSE → select → angles) lives in useScanFlow;
  // this hook owns job-phase state (polling, resume, retry, navigation).
  const flow = useScanFlow({ auth0Id, onAnalyze: startAnalysisForScan })

  // Derived pipeline state: the poll loop owns analyzing/rendering/completed
  // (jobPhase set), otherwise the scan flow phase shows through. Scan errors
  // surface from the flow; job errors from the poll loop.
  const pipelineState: PipelineState = jobPhase ?? (flow.phase === 'error' ? 'error' : flow.phase)
  const errorStatus: CoachAIError | null = jobError ?? flow.errorStatus

  // Keep a ref of the derived state for the retry generation guard.
  const pipelineStateRef = useRef<PipelineState>(pipelineState)
  useEffect(() => {
    pipelineStateRef.current = pipelineState
  }, [pipelineState])

  // Surface scan errors via notify (player toasts). Validation stays
  // inline-only (client + non-retryable), as before — no toast spam for a
  // wrong file pick. Dedupes against the analyze-path toasts.
  useEffect(() => {
    const flowError = flow.errorStatus
    if (!flowError) return
    if (flowError.layer === 'client' && !flowError.retryable) return
    const key = `${flowError.code}:${flowError.message}`
    if (lastNotifyKeyRef.current === key) return
    const notify = notifyRef.current
    if (!notify?.error) return
    lastNotifyKeyRef.current = key
    notify.error(flowError.code, flowError.message)
  }, [flow.errorStatus])

  const handleFileSelected = useCallback(
    (file: File) => {
      // A fresh upload supersedes any prior job so the new scan always paints
      // (the player card reuses its dropzone after completion).
      lastNotifyKeyRef.current = null
      stopPolling()
      setJobId(null)
      setJobStatus(null)
      setJobError(null)
      setJobPhase(null)
      flow.handleFileSelected(file)
    },
    [flow, stopPolling],
  )

  const handleAddAngle = useCallback(
    (file: File, angle: string) => {
      lastNotifyKeyRef.current = null
      flow.handleAddAngle(file, angle)
    },
    [flow],
  )

  const handleRetry = useCallback(() => {
    stopPolling()

    const decision = decideRetryAction({
      error: errorStatus,
      scanResult: flow.scanResult,
      selectedPlayerIndex: flow.selectedPlayerIndex,
    })

    if (decision === 'rekickoff') {
      setJobStatus(null)
      setJobError(null)
      lastNotifyKeyRef.current = null

      if (flow.selectedPlayerIndex !== null && flow.scanResult) {
        setJobPhase('analyzing')
        const gen = ++retryGenerationRef.current
        const scan = flow.scanResult
        const playerIndex = flow.selectedPlayerIndex
        startAnalysisImpl(scan, playerIndex)
          .then(({ job_id }) => {
            // Don't start polling if pipeline was reset or another retry started
            if (!shouldApplyRekickoff(gen, retryGenerationRef.current, pipelineStateRef.current)) {
              return
            }
            setJobId(job_id)
            startPolling(job_id)
            navigateToAnalysis(job_id)
          })
          .catch((e: unknown) => {
            if (retryGenerationRef.current !== gen) return
            const coachErr = toCoachAIError(e)
            setJobError(coachErr)
            setJobPhase('error')
            notifyErrorOnce(coachErr.code, coachErr.message)
          })
      } else {
        flow.revive()
      }
    } else if (decision === 'revive') {
      setJobStatus(null)
      setJobError(null)
      lastNotifyKeyRef.current = null
      flow.revive()
    } else {
      lastNotifyKeyRef.current = null
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
    startAnalysisImpl,
    navigateToAnalysis,
    notifyErrorOnce,
  ])

  const handleReset = useCallback(() => {
    stopPolling()
    lastNotifyKeyRef.current = null
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

  const snapshot: PipelineSnapshot = {
    phase: pipelineState,
    progress: jobStatus
      ? capPipelineProgress(jobStatus.progress)
      : (flow.uploadProgress?.percent ?? 0),
    scanResult: flow.scanResult,
    job: { id: jobId, status: jobStatus },
    error: errorStatus,
  }

  const send = useCallback(
    (event: PipelineEvent) => {
      switch (event.type) {
        case 'file':
          handleFileSelected(event.file)
          break
        case 'addAngle':
          handleAddAngle(event.file, event.angle)
          break
        case 'angleChange':
          flow.handleAngleChange(event.angle)
          break
        case 'player':
          flow.handlePlayerSelected(event.index)
          break
        case 'retry':
          handleRetry()
          break
        case 'reset':
          handleReset()
          break
        case 'chat':
          handleStartChat()
          break
        case 'back':
          handleBackToResults()
          break
      }
    },
    [
      handleFileSelected,
      handleAddAngle,
      flow,
      handleRetry,
      handleReset,
      handleStartChat,
      handleBackToResults,
    ],
  )

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
    handleFileSelected,
    handlePlayerSelected: flow.handlePlayerSelected,
    handleAddAngle,
    handleAngleChange: flow.handleAngleChange,
    handleRetry,
    handleReset,
    handleStartChat,
    handleBackToResults,
    snapshot,
    send,
  }
}
