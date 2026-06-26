'use client'

import { useRef, useEffect, useMemo } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { JobStatus } from '@/types'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface AnalysisProgressProps {
  status: JobStatus | null
}

const STAGES = [
  { name: "Queued",              icon: "⏳" },
  { name: "Uploading",           icon: "📤" },
  { name: "Extracting Frames",   icon: "🎞️" },
  { name: "Detecting Players",   icon: "🔍" },
  { name: "Analyzing Technique", icon: "🤖" },
  { name: "Generating Feedback", icon: "💬" },
  { name: "Rendering Video",     icon: "🎬" },
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
    if (stageName.toLowerCase().includes("waiting")) return 4
    if (stageName.toLowerCase().includes("detecting events")) return 3
    return Math.min((status?.stage ?? 0) + 1, STAGES.length - 1)
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
    <div ref={containerRef} className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center">
      <div className="max-w-3xl w-full">
        <div className="gsap-progress-item text-center mb-10">
          <h1 className="font-display text-4xl font-bold bg-gradient-to-r from-teal-400 to-cyan-500 bg-clip-text text-transparent drop-shadow-lg">
            Analyzing Network Data
          </h1>
          <p className="mt-2 text-zinc-400">Processing visual streams on secure AI nodes.</p>
        </div>

        {/* Status Banners */}
        {currentStageIndex === 0 && (
          <div className="gsap-progress-item mb-8 p-4 rounded-xl bg-teal-950/40 border border-teal-800/50 backdrop-blur-md shadow-[0_0_15px_rgba(20,184,166,0.15)] flex items-center gap-3">
            <span className="text-xl animate-pulse">⏳</span>
            <p className="text-teal-300 text-sm font-medium">Node connected. Job is queued and waiting for compute allocation...</p>
          </div>
        )}

        {isWaitingForQuota && (
          <div className="gsap-progress-item mb-8 p-4 rounded-xl bg-purple-950/40 border border-purple-800/50 backdrop-blur-md shadow-[0_0_15px_rgba(168,85,247,0.15)] flex items-center gap-3">
            <span className="text-xl animate-pulse">⚡</span>
            <p className="text-purple-300 text-sm font-medium">API limits reached. Auto-retrying via failover node in ~60s...</p>
          </div>
        )}

        {/* Main UI Container */}
        <div className="gsap-progress-item flex flex-col gap-8 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-6 sm:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          
          {/* Decorative Glow */}
          <div className="absolute top-0 right-0 -mt-20 -mr-20 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />

          {/* Crypto-Style Progress Bar Block */}
          <div className="flex flex-col gap-6 rounded-xl border-2 border-dashed border-zinc-700/50 bg-zinc-900/30 p-8 pt-10 relative">
            
            {/* Status Heading */}
            <h3 className="flex h-10 items-center justify-center text-center text-lg font-semibold tracking-wide">
              {progress === 100 ? (
                <span className="inline-flex items-center gap-2 text-teal-400 drop-shadow-[0_0_8px_rgba(45,212,191,0.5)]">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                    <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                  <span>Verification Complete</span>
                </span>
              ) : (
                <span className="text-zinc-200 tabular-nums">Processing: {Math.trunc(progress)}%</span>
              )}
            </h3>

            {/* The Bar */}
            <div className="flex h-2 w-full items-center overflow-hidden rounded-full bg-zinc-800 shadow-inner">
              <div
                role="progressbar"
                className="flex items-center justify-center self-stretch rounded-full bg-gradient-to-r from-teal-600 to-teal-400 text-xs font-medium text-white transition-all duration-500 ease-out shadow-[0_0_12px_rgba(45,212,191,0.8)]"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                style={{ width: `${progress}%` }}
              ></div>
            </div>

            {/* Subtext info */}
            <div className="flex justify-between items-center text-xs font-medium text-zinc-500 uppercase tracking-widest mt-2">
              <span className="text-teal-500/80 animate-pulse">{stageName}</span>
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
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-all duration-300 ${
                    isActive 
                      ? 'bg-teal-950/30 border-teal-500/40 shadow-[0_0_15px_rgba(20,184,166,0.1)]' 
                      : isCompleted
                        ? 'bg-zinc-900/40 border-zinc-800/60'
                        : 'bg-zinc-900/10 border-transparent opacity-50'
                  }`}
                >
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all duration-300 ${
                    isActive
                      ? 'bg-teal-500/20 text-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.4)] border border-teal-500/50'
                      : isCompleted
                        ? 'bg-zinc-800 text-teal-500 border border-teal-900'
                        : 'bg-zinc-900/50 text-zinc-600 border border-zinc-800'
                  }`}>
                    {isCompleted ? '✓' : stage.icon}
                  </div>
                  <span className={`text-sm tracking-wide ${
                    isActive ? 'text-teal-300 font-semibold' :
                    isCompleted ? 'text-zinc-300' : 'text-zinc-500 font-medium'
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
  )
}
