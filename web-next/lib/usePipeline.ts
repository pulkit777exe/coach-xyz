'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { scanVideoWithProgress, streamScanProgress, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import type { PipelineState, ScanResult, JobStatus, UploadProgress } from '@/types'
import { MAX_FILE_SIZE_BYTES } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

// ── Shared Error Conversion ───────────────────────────────────────────────────
// Converts unknown errors from fetch/API calls into CoachAIError format.
function toCoachAIError(err: unknown): CoachAIError {
  // AbortError from AbortSignal.timeout()
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', layer: 'client', retryable: true }
  }
  // Already a CoachAIError (has code, message, layer, retryable)
  if (err && typeof err === 'object' && 'code' in err && typeof (err as Record<string, unknown>).code === 'string') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string' && typeof obj.retryable === 'boolean') {
      return err as CoachAIError
    }
  }
  // Unknown error
  return { code: 'UNKNOWN', message: String(err), layer: 'client', retryable: false }
}

const ENGINE_STATE_MAP: Record<string, PipelineState> = {
  uploading: 'uploading',
  scanning: 'scanning',
  player_selection: 'selecting',
  analyzing: 'analyzing',
  rendering: 'rendering',
  completed: 'completed',
  failed: 'error',
}

export interface PipelineActions {
  handleFileSelected: (file: File) => void
  handlePlayerSelected: (playerIndex: number) => void
  handleRetry: () => void
  handleReset: () => void
  handleStartChat: () => void
  handleBackToResults: () => void
}

export interface Pipeline extends PipelineActions {
  pipelineState: PipelineState
  scanResult: ScanResult | null
  selectedPlayerIndex: number | null
  jobId: string | null
  jobStatus: JobStatus | null
  errorStatus: CoachAIError | null
  uploadProgress: UploadProgress | null
}

export function usePipeline(auth0Id: string | null = null, initialJobId: string | null = null): Pipeline {
  const router = useRouter()
  const pathname = usePathname()
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)

  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const pollStart = useRef<number>(Date.now())
  const pipelineStateRef = useRef<PipelineState>(pipelineState)
  const retryGenerationRef = useRef(0)

  // Keep ref in sync with state for use in callbacks without stale closures
  useEffect(() => { pipelineStateRef.current = pipelineState }, [pipelineState])

  // ── Keep-alive ping ────────────────────────────────────────────────────
  useEffect(() => {
    if (!BASE) return
    const ping = () => fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────
  const pollActiveRef = useRef(false)
  const pollConsecutiveFailures = useRef(0)
  const MAX_POLL_RETRIES = 5

  const stopPolling = useCallback(() => {
    pollActiveRef.current = false
    pollConsecutiveFailures.current = 0
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }, [])

  const startPolling = useCallback(
    (pollJobId: string) => {
      stopPolling()
      pollActiveRef.current = true
      pollStart.current = Date.now()
      pollConsecutiveFailures.current = 0
      const POLL_TIMEOUT = 12 * 60 * 1000
      const BASE_POLL_INTERVAL = 2000

      const pollFn = async () => {
        if (!pollActiveRef.current) return
        if (Date.now() - pollStart.current > POLL_TIMEOUT) {
          stopPolling()
          setErrorStatus({
            code: 'ANALYSIS_TIMEOUT',
            message: 'Analysis is taking longer than expected. The job may still complete.',
            layer: 'client',
            retryable: false,
          })
          setPipelineState('error')
          return
        }

        try {
          const status = await getJobStatus(pollJobId)
          if (!pollActiveRef.current) return

          // Reset failure count on success
          pollConsecutiveFailures.current = 0

          if (status.complete) {
            stopPolling()
            if (status.error) {
              // Store the error status first, then flip pipeline state.
              // Never store a complete/100% jobStatus while still on the
              // progress screen — that's what causes the 100% flash.
              setErrorStatus({
                code: status.error_code ?? 'ANALYSIS_FAILED',
                message: status.error,
                layer: 'engine',
                retryable: status.retryable ?? true,
              })
              setJobStatus(status)
              setPipelineState('error')
            } else {
              // Flip pipeline state BEFORE writing jobStatus so that
              // AnalysisProgress never receives a status with progress=100.
              // React batches these two setState calls in the same render.
              setPipelineState('completed')
              setJobStatus(status)
            }
          } else {
            // Job still in progress — safe to update status and stage display.
            // Cap the displayed progress at 99 while the job is not yet
            // complete, so the bar never reaches 100% on the loading screen.
            const displayStatus = status.progress >= 100
              ? { ...status, progress: 99 }
              : status
            setJobStatus(displayStatus)
            if (status.state) {
              const mapped = ENGINE_STATE_MAP[status.state]
              if (mapped) setPipelineState(mapped)
            }
          }
        } catch (err: unknown) {
          if (!pollActiveRef.current) return

          pollConsecutiveFailures.current++

          // Check if error is transient (network, timeout)
          const isTransient = err instanceof DOMException && err.name === 'AbortError'
            || (err && typeof err === 'object' && 'code' in err && (err as Record<string, unknown>).code === 'NETWORK_ERROR')

          if (isTransient && pollConsecutiveFailures.current < MAX_POLL_RETRIES) {
            // Back off but keep polling for transient errors
            const delay = Math.min(BASE_POLL_INTERVAL * Math.pow(2, pollConsecutiveFailures.current), 30_000)
            if (pollInterval.current) clearInterval(pollInterval.current)
            pollInterval.current = setInterval(pollFn, delay)
          } else {
            // Permanent failure or max retries exceeded
            stopPolling()
            setErrorStatus(toCoachAIError(err))
            setPipelineState('error')
          }
        }
      }

      pollInterval.current = setInterval(pollFn, BASE_POLL_INTERVAL)
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
            setErrorStatus({
              code: status.error_code ?? 'ANALYSIS_FAILED',
              message: status.error,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setPipelineState('error')
          } else {
            setPipelineState('completed')
            setJobStatus(status)
          }
        } else {
          // Job still in progress — resume polling
          setJobStatus(status)
          if (status.state) {
            const mapped = ENGINE_STATE_MAP[status.state]
            if (mapped) setPipelineState(mapped)
          }
          startPolling(initialJobId)
        }
      } catch {
        if (cancelled) return
        setErrorStatus({
          code: 'JOB_NOT_FOUND',
          message: 'Could not resume analysis. It may have expired.',
          layer: 'client',
          retryable: false,
        })
        setPipelineState('error')
      }
    }

    resume()
    return () => { cancelled = true }
  }, [initialJobId, startPolling])

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleFileSelected = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setErrorStatus({
        code: 'INVALID_TYPE',
        message: 'Please select a valid video file.',
        layer: 'client',
        retryable: false,
      })
      setPipelineState('error')
      return
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorStatus({
        code: 'FILE_TOO_LARGE',
        message: 'File size must be less than 500MB.',
        layer: 'client',
        retryable: false,
      })
      setPipelineState('error')
      return
    }

    setPipelineState('uploading')
    setUploadProgress({ phase: 'uploading', percent: 0 })

    // AbortController for scan progress SSE stream
    const scanAbort = new AbortController()

    try {
      const result = await scanVideoWithProgress(
        file,
        (progress) => setUploadProgress(progress),
        auth0Id,
      )

      // Upload done — transition to scanning phase
      setPipelineState('scanning')
      setUploadProgress({ phase: 'scanning', percent: 0 })

      // Stream real scan progress from engine via SSE
      try {
        for await (const event of streamScanProgress(result.session_token, scanAbort.signal)) {
          if (event.total > 0) {
            const percent = Math.round((event.current / event.total) * 100)
            setUploadProgress({ phase: 'scanning', percent })
          }
          if (event.complete) {
            if (event.error) {
              throw {
                code: 'SCAN_FAILED',
                message: event.error,
                layer: 'engine',
                retryable: true,
              } as CoachAIError
            }
            break
          }
        }
      } catch (err: unknown) {
        // If aborted (e.g., unmount), don't throw
        if (err instanceof DOMException && err.name === 'AbortError') return
        throw err
      }

      setScanResult(result)

      if (result.player_count === 1) {
        const playerIdx = result.players[0]?.player_index ?? 1
        setSelectedPlayerIndex(playerIdx)
        setPipelineState('analyzing')
        setUploadProgress(null)
        const { job_id } = await startAnalysis({
          session_token: result.session_token,
          player_index: playerIdx,
          video_key: result.video_key,
          auth0Id,
        })
        setJobId(job_id)
        startPolling(job_id)
        if (pathname !== `/dashboard/analysis/${job_id}`) {
          router.push(`/dashboard/analysis/${job_id}`)
        }
      } else {
        setPipelineState('selecting')
        setUploadProgress(null)
      }
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
      setUploadProgress(null)
    } finally {
      scanAbort.abort()
    }
  }, [auth0Id, startPolling, router, pathname])

  const handlePlayerSelected = useCallback(async (playerIndex: number) => {
    if (!scanResult) return
    setSelectedPlayerIndex(playerIndex)
    setPipelineState('analyzing')
    try {
      const { job_id } = await startAnalysis({
        session_token: scanResult.session_token,
        player_index: playerIndex,
        video_key: scanResult.video_key,
        auth0Id,
      })
      setJobId(job_id)
      startPolling(job_id)
      if (pathname !== `/dashboard/analysis/${job_id}`) {
        router.push(`/dashboard/analysis/${job_id}`)
      }
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
    }
  }, [scanResult, startPolling, auth0Id, router, pathname])

  const handleRetry = useCallback(() => {
    stopPolling()

    if (scanResult && errorStatus?.retryable && errorStatus?.layer !== 'client') {
      setJobStatus(null)
      setErrorStatus(null)

      if (selectedPlayerIndex !== null) {
        setPipelineState('analyzing')
        const gen = ++retryGenerationRef.current
        startAnalysis({
          session_token: scanResult.session_token,
          player_index: selectedPlayerIndex,
          video_key: scanResult.video_key,
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
            setErrorStatus(toCoachAIError(e))
            setPipelineState('error')
          })
      } else {
        setPipelineState('selecting')
      }
    } else {
      setPipelineState('idle')
      setScanResult(null)
      setSelectedPlayerIndex(null)
      setJobId(null)
      setJobStatus(null)
      setErrorStatus(null)
      setUploadProgress(null)
    }
  }, [scanResult, selectedPlayerIndex, errorStatus, stopPolling, startPolling, auth0Id])

  const handleReset = useCallback(() => {
    stopPolling()
    setPipelineState('idle')
    setScanResult(null)
    setSelectedPlayerIndex(null)
    setJobId(null)
    setJobStatus(null)
    setErrorStatus(null)
    setUploadProgress(null)
  }, [stopPolling])

  const handleStartChat = useCallback(() => {
    setPipelineState('chatting')
  }, [])

  const handleBackToResults = useCallback(() => {
    setPipelineState('completed')
  }, [])

  return {
    pipelineState,
    scanResult,
    selectedPlayerIndex,
    jobId,
    jobStatus,
    errorStatus,
    uploadProgress,
    handleFileSelected,
    handlePlayerSelected,
    handleRetry,
    handleReset,
    handleStartChat,
    handleBackToResults,
  }
}
