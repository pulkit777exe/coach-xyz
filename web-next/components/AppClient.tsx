'use client'

import { useState, useEffect } from 'react'
import { Slide } from 'loading-dev'
import { ProgressBar } from '@/components/interior/progress-bar'
import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import dynamic from 'next/dynamic'

// `ResultsSummary` pulls in GSAP, and GSAP has exactly ONE importer in this app —
// used for a single 0.3s staggered fade-in. Statically importing it here put all
// ~6.4MB of it (plus @gsap/react) into the initial bundle of the LANDING PAGE, for a
// component that renders nothing at all until `jobStatus.summary` exists: a first-time
// visitor, or anyone who has not finished an analysis, paid for it and saw no trace of
// it. This is the same rule the repo already applies to recharts (AGENTS.md: "Heavy
// client visuals load via `next/dynamic`"), and the same fix in `AnalysisDetailClient`.
//
// `ssr: false` because GSAP's plugin registration is client-only — and the component
// already renders a plain loading shell until data arrives, so there is no SSR content
// being deferred.
const ResultsSummary = dynamic(() => import('@/components/ResultsSummary'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center pt-20">
      <Slide />
    </div>
  ),
})
import ErrorScreen from '@/components/ErrorScreen'
import ChatLayout from '@/components/ChatLayout'
import { usePipeline } from '@/lib/usePipeline'

const UPLOAD_MESSAGES = ['Uploading video...', 'Compressing frames...', 'Almost there...']

const SCANNING_MESSAGES = [
  'Finding players...',
  'Detecting movement patterns...',
  'Analyzing form...',
  'Identifying key moments...',
]

function RotatingMessage({ messages, percent }: { messages: string[]; percent: number }) {
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
        className="text-foreground text-title font-medium transition-opacity duration-200 ease-in-out"
        style={{ opacity }}
      >
        {messages[index]}
      </p>
      <ProgressBar
        value={percent > 0 ? percent : null}
        label="Progress"
        pendingLabel="Starting"
        completeLabel="Upload complete"
        className="mt-1 w-full max-w-[320px]"
      />
    </div>
  )
}

export default function AppClient({
  auth0Id,
  orgAuth0Id = null,
}: {
  auth0Id: string | null
  orgAuth0Id?: string | null
}) {
  const {
    pipelineState,
    scanResult,
    angleScans,
    activeAngle,
    jobId,
    jobStatus,
    errorStatus,
    uploadProgress,
    handleFileSelected,
    handlePlayerSelected,
    handleAddAngle,
    handleAngleChange,
    handleRetry,
    handleReset,
    handleStartChat,
    handleBackToResults,
  } = usePipeline(auth0Id)

  const progressPercent = uploadProgress?.percent ?? 0
  const activeScan = angleScans.find((s) => (s.angle ?? 'primary') === activeAngle) ?? scanResult
  const angleLabels = angleScans.map((s) => s.angle ?? 'primary')

  switch (pipelineState) {
    case 'idle':
      return <LandingPage onFileSelected={handleFileSelected} />

    case 'uploading':
    case 'scanning':
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center">
          <Slide size={48} className="mb-6" />
          <RotatingMessage
            messages={pipelineState === 'uploading' ? UPLOAD_MESSAGES : SCANNING_MESSAGES}
            percent={progressPercent}
          />
        </div>
      )

    case 'selecting':
      if (!activeScan) return <LandingPage onFileSelected={handleFileSelected} />
      return (
        <PlayerSelector
          players={activeScan.players}
          angles={angleLabels}
          activeAngle={activeAngle}
          onAngleChange={handleAngleChange}
          onAddAngle={handleAddAngle}
          onSelect={handlePlayerSelected}
        />
      )

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
          auth0Id={auth0Id}
          orgAuth0Id={orgAuth0Id}
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
