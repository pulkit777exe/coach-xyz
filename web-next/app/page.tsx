'use client'

import { useState, useEffect, useRef } from 'react'
import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import ResultsSummary from '@/components/ResultsSummary'
import ErrorScreen from '@/components/ErrorScreen'
import { scanVideo, startAnalysis, getJobStatus } from '@/lib/api'
import type { AppState, ScanResult, JobStatus } from '@/types'

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [errorCode, setErrorCode] = useState<string>('')

  // Refs
  const pollInterval = useRef<NodeJS.Timeout | null>(null)

  // Helper functions
  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }

  const startPolling = (jobId: string) => {
    pollInterval.current = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId)
        setJobStatus(status)
        if (status.complete) {
          stopPolling()
          if (status.error) {
            setErrorCode('ANALYSIS_FAILED')
            setErrorMessage(status.error)
            setAppState('error')
          } else {
            setAppState('done')
          }
        }
      } catch {
        stopPolling()
        setErrorCode('POLLING_FAILED')
        setErrorMessage('Lost connection during analysis. Please try again.')
        setAppState('error')
      }
    }, 2000)
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  const handleFileSelected = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setErrorCode('INVALID_TYPE')
      setErrorMessage('Please select a valid video file')
      setAppState('error')
      return
    }

    if (file.size > 500 * 1024 * 1024) {
      setErrorCode('FILE_TOO_LARGE')
      setErrorMessage('File size must be less than 500MB')
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
      setErrorCode(e.code ?? 'UNKNOWN')
      setErrorMessage(e.message ?? 'Something went wrong during scanning')
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
      setErrorCode(e.code ?? 'UNKNOWN')
      setErrorMessage(e.message ?? 'Could not start analysis')
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
    setErrorMessage('')
    setErrorCode('')
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
      return <ErrorScreen code={errorCode} message={errorMessage} onRetry={handleReset} />
    default:
      return <LandingPage onFileSelected={handleFileSelected} />
  }
}
