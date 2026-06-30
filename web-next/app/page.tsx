'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import ResultsSummary from '@/components/ResultsSummary'
import ErrorScreen from '@/components/ErrorScreen'
import { scanVideo, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import { getBetaCode } from '@/lib/betaCode'
import type { PipelineState, ScanResult, JobStatus } from '@/types'

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

export default function Home() {
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
    const ping = () => fetch(`${BASE}/health`).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }, [])

  const startPolling = useCallback(
    (pollJobId: string) => {
      pollStart.current = Date.now()
      const POLL_TIMEOUT = 12 * 60 * 1000

      pollInterval.current = setInterval(async () => {
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
        } catch (err: any) {
          stopPolling()
          setErrorStatus(err as CoachAIError)
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

    if (file.size > 500 * 1024 * 1024) {
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
    } catch (e: any) {
      if (e.code === 'INVALID_BETA_CODE') {
        return
      }
      setErrorStatus(e as CoachAIError)
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
    } catch (e: any) {
      setErrorStatus(e as CoachAIError)
      setPipelineState('error')
    }
  }

  const handleRetry = useCallback(() => {
    stopPolling()

    // If error was during analysis and we have scan results, retry analysis
    if (scanResult && errorStatus?.retryable && errorStatus?.layer !== 'client') {
      setJobStatus(null)
      setErrorStatus(null)

      if (selectedPlayerIndex) {
        setPipelineState('analyzing')
        startAnalysis({
          session_token: scanResult.session_token,
          player_index: selectedPlayerIndex,
        })
          .then(({ job_id }) => {
            setJobId(job_id)
            startPolling(job_id)
          })
          .catch((e: any) => {
            setErrorStatus(e as CoachAIError)
            setPipelineState('error')
          })
      } else {
        setPipelineState('selecting')
      }
    } else {
      // Full reset for client errors or non-retryable errors
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

  switch (pipelineState) {
    case 'idle':
      return <LandingPage onFileSelected={handleFileSelected} />

    case 'uploading':
    case 'scanning':
      return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-gray-700 border-t-indigo-500 rounded-full animate-spin mb-4" />
          <p className="text-white text-lg">
            {pipelineState === 'uploading' ? 'Uploading video...' : 'Finding players...'}
          </p>
        </div>
      )

    case 'selecting':
      return <PlayerSelector players={scanResult!.players} onSelect={handlePlayerSelected} />

    case 'analyzing':
    case 'rendering':
      return <AnalysisProgress status={jobStatus} />

    case 'completed':
      return <ResultsSummary status={jobStatus!} jobId={jobId!} onReset={handleReset} />

    case 'error':
      return <ErrorScreen error={errorStatus!} onRetry={handleRetry} />

    default:
      return <LandingPage onFileSelected={handleFileSelected} />
  }
}
