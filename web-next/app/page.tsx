'use client'

import LandingPage from '@/components/LandingPage'
import PlayerSelector from '@/components/PlayerSelector'
import AnalysisProgress from '@/components/AnalysisProgress'
import ResultsSummary from '@/components/ResultsSummary'
import ErrorScreen from '@/components/ErrorScreen'
import { usePipeline } from '@/lib/usePipeline'

export default function Home() {
  const {
    pipelineState,
    scanResult,
    jobId,
    jobStatus,
    errorStatus,
    handleFileSelected,
    handlePlayerSelected,
    handleRetry,
    handleReset,
  } = usePipeline()

  switch (pipelineState) {
    case 'idle':
      return <LandingPage onFileSelected={handleFileSelected} />

    case 'uploading':
    case 'scanning':
      return (
        <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-[var(--cream-10)] border-t-[var(--fg)] rounded-full animate-spin mb-4" />
          <p className="text-[var(--fg)] text-lg">
            {pipelineState === 'uploading' ? 'Uploading video...' : 'Finding players...'}
          </p>
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
      return <ResultsSummary status={jobStatus} jobId={jobId} onReset={handleReset} />

    case 'error':
      if (!errorStatus) return <LandingPage onFileSelected={handleFileSelected} />
      return <ErrorScreen error={errorStatus} onRetry={handleRetry} />

    default:
      return <LandingPage onFileSelected={handleFileSelected} />
  }
}
