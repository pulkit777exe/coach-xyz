'use client'

import { useState, useEffect } from 'react'
import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import ResultsSummary from '@/components/ResultsSummary'
import ErrorScreen from '@/components/ErrorScreen'
import ChatLayout from '@/components/ChatLayout'
import { usePipeline } from '@/lib/usePipeline'

const UPLOAD_MESSAGES = [
  'Uploading video...',
  'Compressing frames...',
  'Almost there...',
]

const SCANNING_MESSAGES = [
  'Finding players...',
  'Detecting movement patterns...',
  'Analyzing form...',
  'Identifying key moments...',
]

function RotatingMessage({
  messages,
  percent,
}: {
  messages: string[]
  percent: number
}) {
  const [index, setIndex] = useState(0)
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    const fadeIn = setTimeout(() => setOpacity(1), 50)
    return () => clearTimeout(fadeIn)
  }, [])

  useEffect(() => {
    let fadeBack: ReturnType<typeof setTimeout> | undefined
    const interval = setInterval(() => {
      setOpacity(0)
      fadeBack = setTimeout(() => {
        setIndex((prev) => (prev + 1) % messages.length)
        setOpacity(1)
      }, 300)
    }, 2500)
    return () => {
      clearInterval(interval)
      if (fadeBack) clearTimeout(fadeBack)
    }
  }, [messages.length])

  return (
    <div className="flex flex-col items-center gap-2">
      <p
        className="text-(--fg) text-lg transition-opacity duration-300 ease-in-out"
        style={{ opacity }}
      >
        {messages[index]}
      </p>
      <span className="text-(--cream-40) text-sm tabular-nums">
        {Math.round(percent)}%
      </span>
    </div>
  )
}

export default function AppClient({ auth0Id }: { auth0Id: string | null }) {
  const {
    pipelineState,
    scanResult,
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
  } = usePipeline(auth0Id)

  const progressPercent = uploadProgress?.percent ?? 0

  switch (pipelineState) {
    case 'idle':
      return <LandingPage onFileSelected={handleFileSelected} />

    case 'uploading':
    case 'scanning':
      return (
        <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-(--cream-10) border-t-(--fg) rounded-full animate-spin mb-6" />
          <RotatingMessage
            messages={
              pipelineState === 'uploading' ? UPLOAD_MESSAGES : SCANNING_MESSAGES
            }
            percent={progressPercent}
          />
        </div>
      )

    case 'selecting':
      if (!scanResult) return <LandingPage onFileSelected={handleFileSelected} />
      return <PlayerSelector players={scanResult.players} onSelect={handlePlayerSelected} />

    case 'analyzing':
    case 'rendering':
      return <AnalysisProgress status={jobStatus} />

    case 'completed':
      if (!jobStatus || !jobId) return <LandingPage onFileSelected={handleFileSelected} />
      return (
        <ResultsSummary
          status={jobStatus}
          jobId={jobId}
          onReset={handleReset}
          onStartChat={handleStartChat}
        />
      )

    case 'chatting':
      if (!jobId) return <LandingPage onFileSelected={handleFileSelected} />
      return (
        <ChatLayout
          jobId={jobId}
          jobStatus={jobStatus}
          onBackToResults={handleBackToResults}
        />
      )

    case 'error':
      if (!errorStatus) return <LandingPage onFileSelected={handleFileSelected} />
      return <ErrorScreen error={errorStatus} onRetry={handleRetry} />

    default:
      return <LandingPage onFileSelected={handleFileSelected} />
  }
}
