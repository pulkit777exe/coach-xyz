'use client'

import { useRef, useEffect, useMemo } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { AppHeader } from '@/components/AppHeader'
import type { JobStatus } from '@/types'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface AnalysisProgressProps {
  status: JobStatus | null
}

const STAGES = [
  { name: "Queued",              icon: "⏳" },
  { name: "Detecting Players",   icon: "🔍" },
  { name: "Analyzing Technique", icon: "🤖" },
  { name: "Rendering Video",     icon: "🎬" },
  { name: "Complete",            icon: "✅" },
]

export default function AnalysisProgress({ status }: AnalysisProgressProps) {
  const progress = status?.progress ?? 0
  const stageName = status?.stage_name ?? "Queued"
  const lastProgressRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(Date.now())

  // Match current stage by stage_name string, not stage number
  const currentStageIndex = useMemo(() => {
    const idx = STAGES.findIndex(
      s => stageName.toLowerCase().startsWith(s.name.toLowerCase())
    )
    if (idx >= 0) return idx
    if (stageName.toLowerCase().includes("queue")) return 0
    if (stageName.toLowerCase().includes("detect")) return 1
    if (stageName.toLowerCase().includes("analy")) return 2
    if (stageName.toLowerCase().includes("render")) return 3
    if (stageName.toLowerCase().includes("complete")) return 4
    return Math.min((status?.stage ?? 0), STAGES.length - 1)
  }, [stageName, status?.stage])

  const estimatedSeconds = () => {
    if (progress <= 0 || progress >= 100) return 0
    const now = Date.now()
    const timeElapsed = (now - lastTimeRef.current) / 1000
    const progressDelta = progress - lastProgressRef.current

    if (progressDelta <= 0) return 0

    const timePerPercent = timeElapsed / progressDelta
    const remainingPercent = 100 - progress
    return Math.round(timePerPercent * remainingPercent)
  }

  useEffect(() => {
    if (progress > lastProgressRef.current) {
      lastProgressRef.current = progress
      lastTimeRef.current = Date.now()
    }
  }, [progress])

  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from('.gsap-progress-item', {
      y: 20,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power2.out'
    })
  }, { scope: containerRef })

  const isWaitingForQuota = stageName.toLowerCase().includes("waiting for ai quota")

  return (
    <>
      <AppHeader />
      <div ref={containerRef} className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center pt-20">
      <div className="max-w-3xl w-full">
        <div className="gsap-progress-item text-center mb-10">
          <h1 className="font-serif text-4xl font-bold text-[var(--fg)]">
            Analyzing Network Data
          </h1>
          <p className="mt-2 text-[var(--cream-40)]">Processing visual streams on secure AI nodes.</p>
        </div>

        {/* Status Banners */}
        {currentStageIndex === 0 && (
          <div className="gsap-progress-item mb-8 p-4 rounded-none bg-[var(--cream-05)] border border-[var(--cream-10)] flex items-center gap-3">
            <span className="text-xl animate-pulse">⏳</span>
            <p className="text-[var(--cream-40)] text-sm font-medium">Node connected. Job is queued and waiting for compute allocation...</p>
          </div>
        )}

        {isWaitingForQuota && (
          <div className="gsap-progress-item mb-8 p-4 rounded-none bg-[var(--cream-05)] border border-[var(--cream-10)] flex items-center gap-3">
            <span className="text-xl animate-pulse">⚡</span>
            <p className="text-[var(--cream-40)] text-sm font-medium">API limits reached. Auto-retrying via failover node in ~60s...</p>
          </div>
        )}

        {/* Main UI Container */}
        <div className="gsap-progress-item flex flex-col gap-8 rounded-none border border-[var(--cream-10)] bg-[var(--bg)] p-6 sm:p-10 relative overflow-hidden">
          
          {/* Crypto-Style Progress Bar Block */}
          <div className="flex flex-col gap-6 rounded-none border-2 border-dashed border-[var(--cream-10)] bg-[var(--cream-05)] p-8 pt-10 relative">
            
            {/* Status Heading */}
            <h3 className="flex h-10 items-center justify-center text-center text-lg font-semibold tracking-wide" aria-live="polite">
              {progress === 100 ? (
                <span className="inline-flex items-center gap-2 text-[var(--fg)]">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                    <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                  <span>Verification Complete</span>
                </span>
              ) : (
                <span className="text-[var(--cream-40)] tabular-nums">Processing: {Math.trunc(progress)}%</span>
              )}
            </h3>

            {/* The Bar */}
            <div className="flex h-2 w-full items-center overflow-hidden rounded-full bg-[var(--cream-05)] shadow-inner">
              <div
                role="progressbar"
                className="flex items-center justify-center self-stretch rounded-full bg-[var(--fg)] text-xs font-medium text-[var(--bg)] transition-all duration-500 ease-out"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                style={{ width: `${progress}%` }}
              ></div>
            </div>

            {/* Subtext info */}
            <div className="flex justify-between items-center text-xs font-medium text-[var(--cream-40)] uppercase tracking-widest mt-2" aria-live="polite">
              <span className="text-[var(--cream-40)] animate-pulse">{stageName}</span>
              <span>{estimatedSeconds() > 0 ? `ETA: ${estimatedSeconds()}s` : 'Calculating...'}</span>
            </div>
          </div>

          {/* Stage Stepper Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {STAGES.map((stage, index) => {
              const isCompleted = index < currentStageIndex
              const isActive = index === currentStageIndex
              const isPending = index > currentStageIndex

              return (
                <div 
                  key={index} 
                  className={`flex items-center gap-4 p-3 rounded-none border transition-all duration-300 ${
                    isActive 
                      ? 'bg-[var(--cream-05)] border-[var(--cream-20)]' 
                      : isCompleted
                        ? 'bg-[var(--cream-05)] border-[var(--cream-10)]'
                        : 'bg-transparent border-transparent opacity-50'
                  }`}
                >
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all duration-300 ${
                    isActive
                      ? 'bg-[var(--cream-10)] text-[var(--fg)] border border-[var(--cream-20)]'
                      : isCompleted
                        ? 'bg-[var(--cream-05)] text-[var(--fg)] border border-[var(--cream-20)]'
                        : 'bg-transparent text-[var(--cream-40)] border border-[var(--cream-05)]'
                  }`}>
                    <span className="t-icon-swap" data-state={isCompleted ? 'b' : 'a'}>
                      <span className="t-icon" data-icon="a">{stage.icon}</span>
                      <span className="t-icon" data-icon="b">✓</span>
                    </span>
                  </div>
                  <span className={`text-sm tracking-wide ${
                    isActive ? 'text-[var(--fg)] font-semibold' :
                    isCompleted ? 'text-[var(--cream-40)]' : 'text-[var(--cream-40)] font-medium'
                  }`}>
                    {stage.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
