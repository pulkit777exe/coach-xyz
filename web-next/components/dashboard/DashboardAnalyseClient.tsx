'use client'

import { useEffect, useState } from 'react'
import { usePipeline } from '@/lib/usePipeline'
import AnalysisProgress from '@/components/AnalysisProgress'
import PlayerSelector from '@/components/PlayerSelector'
import ErrorScreen from '@/components/ErrorScreen'
import ChatLayout from '@/components/ChatLayout'
import dynamic from 'next/dynamic'
import { AnalyzeUploadCard } from '@/components/dashboard/AnalyzeUploadCard'
import { Button } from '@/components/9ui/ui/button'
import type { JobStatus } from '@/types'

const ResultsSummary = dynamic(() => import('@/components/ResultsSummary'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[400px] items-center justify-center pt-20">
      <div className="text-meta text-muted-foreground">Preparing results…</div>
    </div>
  ),
})

/** Upload / scan progress panel shown while bytes move and the engine scans. */
function UploadProgressView({
  state,
  percent,
}: {
  state: 'uploading' | 'scanning'
  percent: number
}) {
  const messages =
    state === 'uploading'
      ? ['Uploading video…', 'Preparing upload…', 'Almost there…']
      : ['Finding players…', 'Detecting movement patterns…', 'Analyzing form…', 'Identifying key moments…']

  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % messages.length), 2500)
    return () => clearInterval(timer)
  }, [messages.length])

  return (
    <div className="flex min-h-[560px] flex-col items-center justify-center bg-background">
      <div className="max-w-[360px]">
        <p className="text-lead font-semibold text-foreground text-center mb-1">
          {state === 'uploading' ? 'Uploading your video' : 'Scanning for players'}
        </p>
        <p className="text-meta text-muted-foreground text-center mb-6">
          {state === 'uploading'
            ? 'Hang tight while the clip reaches the analysis pipeline.'
            : 'MediaPipe is detecting athletes; Gemini will score the form next.'}
        </p>
        <div className="rounded-[6px] bg-muted px-4 py-3 text-center">
          <span className="text-body font-medium text-foreground">
            {percent > 0 ? percent : 0}%
          </span>
        </div>
        <div className="mt-4 text-caption text-muted-foreground text-center leading-5">
          {messages[index]}
        </div>
      </div>
    </div>
  )
}

/** Completed state: results summary with a path into the chat interface. */
function AnalysisCompleteView({
  status,
  jobId,
  onReset,
  onStartChat,
}: {
  status: JobStatus
  jobId: string
  onReset: () => void
  onStartChat: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lead font-semibold text-foreground">Analysis complete</h2>
            <p className="text-meta text-muted-foreground">
              Review the annotated video, scores and findings — then chat with the AI coach.
            </p>
          </div>
          <Button onClick={onReset} variant="outline">
            Upload another
          </Button>
        </div>
        <ResultsSummary
          status={status}
          jobId={jobId}
          onReset={onReset}
          onStartChat={onStartChat}
        />
      </div>
    </div>
  )
}

export default function DashboardAnalyzeClient({
  auth0Id,
}: {
  auth0Id: string | null
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

  const activeScan =
    angleScans.find((s) => (s.angle ?? 'primary') === activeAngle) ?? scanResult
  const angleLabels = angleScans.map((s) => s.angle ?? 'primary')

  switch (pipelineState) {
    case 'idle':
      return <AnalyzeUploadCard onFileSelected={handleFileSelected} />

    case 'uploading':
    case 'scanning':
      return (
        <UploadProgressView
          state={pipelineState}
          percent={uploadProgress?.percent ?? 0}
        />
      )

    case 'selecting':
      if (!activeScan) {
        return <AnalyzeUploadCard onFileSelected={handleFileSelected} />
      }
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
      if (!jobStatus || !jobId) {
        return <AnalyzeUploadCard onFileSelected={handleFileSelected} />
      }
      return (
        <AnalysisCompleteView
          status={jobStatus}
          jobId={jobId}
          onReset={handleReset}
          onStartChat={handleStartChat}
        />
      )

    case 'chatting':
      if (!jobId) {
        return <AnalyzeUploadCard onFileSelected={handleFileSelected} />
      }
      return (
        <ChatLayout
          auth0Id={auth0Id}
          jobId={jobId}
          jobStatus={jobStatus}
          onBackToResults={handleBackToResults}
        />
      )

    case 'error':
      if (!errorStatus) {
        return <AnalyzeUploadCard onFileSelected={handleFileSelected} />
      }
      return <ErrorScreen error={errorStatus} onRetry={handleRetry} />

    default:
      return <AnalyzeUploadCard onFileSelected={handleFileSelected} />
  }
}
