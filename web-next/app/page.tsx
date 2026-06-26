'use client'

import { useState, useEffect, useRef } from 'react'
import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import ResultsSummary from '@/components/ResultsSummary'
import ErrorScreen from '@/components/ErrorScreen'
import BetaGate from '@/components/BetaGate'
import { scanVideo, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import { getBetaCode } from '@/lib/betaCode'
import type { AppState, ScanResult, JobStatus } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

export default function Home() {
  const [betaVerified, setBetaVerified] = useState(false)
  const [appState, setAppState] = useState<AppState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)

  // Refs
  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const pollStart = useRef<number>(Date.now())

  // Keep-alive ping to prevent Render spin-down
  useEffect(() => {
    const ping = () => fetch(`${BASE}/health`).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Helper functions
  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }

  const startPolling = (pollJobId: string) => {
    pollStart.current = Date.now()
    const POLL_TIMEOUT = 10 * 60 * 1000 // 10 minutes

    pollInterval.current = setInterval(async () => {
      // Timeout check
      if (Date.now() - pollStart.current > POLL_TIMEOUT) {
        stopPolling()
        setErrorStatus({
          code: "ANALYSIS_TIMEOUT",
          message: "Analysis is taking longer than expected. The job may still complete — try refreshing the page in a few minutes.",
          layer: "client",
          retryable: false
        })
        setAppState('error')
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
              retryable: status.retryable ?? true
            })
            setAppState('error')
          } else {
            setAppState('done')
          }
        }
      } catch (err: any) {
        stopPolling()
        setErrorStatus(err as CoachAIError)
        setAppState('error')
      }
    }, 2000)
  }

  useEffect(() => {
    const code = getBetaCode()
    if (code) setBetaVerified(true)
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [])

  const handleFileSelected = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setErrorStatus({
        code: 'INVALID_TYPE',
        message: 'Please select a valid video file',
        layer: 'client',
        retryable: false
      })
      setAppState('error')
      return
    }

    if (file.size > 500 * 1024 * 1024) {
      setErrorStatus({
        code: 'FILE_TOO_LARGE',
        message: 'File size must be less than 500MB',
        layer: 'client',
        retryable: false
      })
      setAppState('error')
      return
    }

    setAppState('scanning')
    try {
      const result = await scanVideo(file)
      setScanResult(result)
      
      if (result.player_count === 1) {
        // Auto-proceed for single player
        setSelectedPlayerIndex(1)
        const { job_id } = await startAnalysis({
          session_token: result.session_token,
          player_index: 1
        })
        setJobId(job_id)
        setAppState('analyzing')
        startPolling(job_id)
      } else {
        setAppState('selecting')
      }
    } catch (e: any) {
      if (e.code === 'INVALID_BETA_CODE') {
        setBetaVerified(false)
        return
      }
      setErrorStatus(e as CoachAIError)
      setAppState('error')
    }
  }

  const handlePlayerSelected = async (playerIndex: number) => {
    setSelectedPlayerIndex(playerIndex)
    setAppState('analyzing')
    try {
      const { job_id } = await startAnalysis({
        session_token: scanResult!.session_token,
        player_index: playerIndex
      })
      setJobId(job_id)
      startPolling(job_id)
    } catch (e: any) {
      setErrorStatus(e as CoachAIError)
      setAppState('error')
    }
  }

  const handleReset = () => {
    stopPolling()
    setAppState('idle')
    setScanResult(null)
    setSelectedPlayerIndex(null)
    setJobId(null)
    setJobStatus(null)
    setErrorStatus(null)
  }

  if (!betaVerified) {
    return <BetaGate onSuccess={() => setBetaVerified(true)} />
  }

  // Render logic
  switch (appState) {
    case 'idle':
      return <LandingPage onFileSelected={handleFileSelected} />
    case 'scanning':
      return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-gray-700 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
          <p className="text-white text-lg">Finding players in your video...</p>
        </div>
      )
    case 'selecting':
      return <PlayerSelector players={scanResult!.players} onSelect={handlePlayerSelected} />
    case 'analyzing':
      return <AnalysisProgress status={jobStatus} />
    case 'done':
      return <ResultsSummary status={jobStatus!} jobId={jobId!} onReset={handleReset} />
    case 'error':
      return <ErrorScreen error={errorStatus!} onRetry={handleReset} />
    default:
      return <LandingPage onFileSelected={handleFileSelected} />
  }
}
