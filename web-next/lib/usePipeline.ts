'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { scanVideo, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import type { PipelineState, ScanResult, JobStatus } from '@/types'
import { MAX_FILE_SIZE_BYTES } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

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

  // ── Keep-alive ping ────────────────────────────────────────────────────
  useEffect(() => {
    if (!BASE) return
    const ping = () => fetch(`${BASE}/health`).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────
  const pollActiveRef = useRef(false)

  const stopPolling = useCallback(() => {
    pollActiveRef.current = false
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
      const POLL_TIMEOUT = 12 * 60 * 1000

      pollInterval.current = setInterval(async () => {
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
          stopPolling()
          // Distinguish AbortError (timeout) from other errors
          let coachErr: CoachAIError
          if (err instanceof DOMException && err.name === 'AbortError') {
            coachErr = { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', layer: 'client', retryable: true }
          } else if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') {
            coachErr = err as CoachAIError
          } else {
            coachErr = { code: 'UNKNOWN', message: String(err), layer: 'client', retryable: false }
          }
          setErrorStatus(coachErr)
          setPipelineState('error')
        }
      }, 2000)
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
        setSelectedPlayerIndex(1)
        setPipelineState('analyzing')
        const { job_id } = await startAnalysis({
          session_token: result.session_token,
          player_index: 1,
        })
        setJobId(job_id)
        startPolling(job_id)
      } else {
        setPipelineState('selecting')
      }
    } catch (e: unknown) {
      let coachErr: CoachAIError
      if (e instanceof DOMException && e.name === 'AbortError') {
        coachErr = { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', layer: 'client', retryable: true }
      } else if (e && typeof e === 'object' && 'code' in e && typeof (e as any).code === 'string') {
        coachErr = e as CoachAIError
      } else {
        coachErr = { code: 'UNKNOWN', message: String(e), layer: 'client', retryable: false }
      }
      setErrorStatus(coachErr)
      setPipelineState('error')
    }
  }

  const handlePlayerSelected = async (playerIndex: number) => {
    setSelectedPlayerIndex(playerIndex)
    setPipelineState('analyzing')
    try {
      const { job_id } = await startAnalysis({
        session_token: scanResult!.session_token,
        player_index: playerIndex,
      })
      setJobId(job_id)
      startPolling(job_id)
    } catch (e: unknown) {
      let coachErr: CoachAIError
      if (e instanceof DOMException && e.name === 'AbortError') {
        coachErr = { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', layer: 'client', retryable: true }
      } else if (e && typeof e === 'object' && 'code' in e && typeof (e as any).code === 'string') {
        coachErr = e as CoachAIError
      } else {
        coachErr = { code: 'UNKNOWN', message: String(e), layer: 'client', retryable: false }
      }
      setErrorStatus(coachErr)
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
        startAnalysis({
          session_token: scanResult.session_token,
          player_index: selectedPlayerIndex,
        })
          .then(({ job_id }) => {
            // Don't start polling if pipeline was reset while request was in-flight
            if (pipelineState === 'idle') return
            setJobId(job_id)
            startPolling(job_id)
          })
          .catch((e: unknown) => {
            const coachErr: CoachAIError =
              e && typeof e === 'object' && 'code' in e && typeof (e as any).code === 'string'
                ? e as CoachAIError
                : { code: 'UNKNOWN', message: String(e), layer: 'client', retryable: false }
            setErrorStatus(coachErr)
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
