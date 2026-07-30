'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { scanVideo, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import type { PipelineState, ScanResult, JobStatus } from '@/types'
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
}

export interface Pipeline extends PipelineActions {
  pipelineState: PipelineState
  scanResult: ScanResult | null
  selectedPlayerIndex: number | null
  jobId: string | null
  jobStatus: JobStatus | null
  errorStatus: CoachAIError | null
}

export function usePipeline(): Pipeline {
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)

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
          setJobStatus(status)

          if (status.complete) {
            stopPolling()
            if (status.error) {
              setErrorStatus({
                code: status.error_code ?? 'ANALYSIS_FAILED',
                message: status.error,
                layer: 'engine',
                retryable: status.retryable ?? true,
              })
              setPipelineState('error')
            } else {
              setPipelineState('completed')
            }
          } else if (status.state) {
            const mapped = ENGINE_STATE_MAP[status.state]
            if (mapped) setPipelineState(mapped)
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

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleFileSelected = async (file: File) => {
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
    try {
      const result = await scanVideo(file)
      setScanResult(result)

      if (result.player_count === 1) {
        const playerIdx = result.players[0]?.player_index ?? 1
        setSelectedPlayerIndex(playerIdx)
        setPipelineState('analyzing')
        const { job_id } = await startAnalysis({
          session_token: result.session_token,
          player_index: playerIdx,
        })
        setJobId(job_id)
        startPolling(job_id)
      } else {
        setPipelineState('selecting')
      }
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
    }
  }

  const handlePlayerSelected = async (playerIndex: number) => {
    if (!scanResult) return
    setSelectedPlayerIndex(playerIndex)
    setPipelineState('analyzing')
    try {
      const { job_id } = await startAnalysis({
        session_token: scanResult.session_token,
        player_index: playerIndex,
      })
      setJobId(job_id)
      startPolling(job_id)
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
    }
  }

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
        })
          .then(({ job_id }) => {
            // Don't start polling if pipeline was reset or another retry started
            if (pipelineStateRef.current === 'idle' || retryGenerationRef.current !== gen) return
            setJobId(job_id)
            startPolling(job_id)
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
    }
  }, [scanResult, selectedPlayerIndex, errorStatus, stopPolling, startPolling])

  const handleReset = useCallback(() => {
    stopPolling()
    setPipelineState('idle')
    setScanResult(null)
    setSelectedPlayerIndex(null)
    setJobId(null)
    setJobStatus(null)
    setErrorStatus(null)
  }, [stopPolling])

  return {
    pipelineState,
    scanResult,
    selectedPlayerIndex,
    jobId,
    jobStatus,
    errorStatus,
    handleFileSelected,
    handlePlayerSelected,
    handleRetry,
    handleReset,
  }
}
