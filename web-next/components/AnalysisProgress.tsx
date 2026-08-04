'use client'

import { useRef, useEffect, useMemo } from 'react'
import type { JobStatus } from '@/types'

interface AnalysisProgressProps {
  status: JobStatus | null
}

const STAGES = [
  { name: "Queued", label: "01" },
  { name: "Detecting Players", label: "02" },
  { name: "Analyzing Technique", label: "03" },
  { name: "Rendering Video", label: "04" },
  { name: "Complete", label: "05" },
]

export default function AnalysisProgress({ status }: AnalysisProgressProps) {
  const progress = status?.progress ?? 0
  const stageName = status?.stage_name ?? "Queued"
  // Cap at 99 while the job is not yet complete — the engine stamps
  // progress=100 on the "completed" state, but this component is only
  // rendered while the pipeline is still in-progress.  Showing 100% here
  // would mislead the user into thinking it's done when it isn't.
  const maxProgress = status?.complete ? 100 : 99
  const boundedProgress = Math.max(0, Math.min(maxProgress, progress))
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

  // ETA: track the timestamp of the *first* non-zero progress tick so we can
  // compute a stable rate over the full elapsed window rather than just the
  // last render cycle (which produces wildly fluctuating estimates).
  const startProgressRef = useRef<{ progress: number; time: number } | null>(null)

  useEffect(() => {
    if (boundedProgress > 0 && boundedProgress < 100) {
      if (!startProgressRef.current) {
        startProgressRef.current = { progress: boundedProgress, time: Date.now() }
      }
      lastProgressRef.current = boundedProgress
      lastTimeRef.current = Date.now()
    }
  }, [boundedProgress])

  const estimatedSeconds = useMemo(() => {
    if (boundedProgress <= 0 || boundedProgress >= 100) return 0
    const start = startProgressRef.current
    if (!start) return 0
    const elapsedMs = Date.now() - start.time
    const progressMade = boundedProgress - start.progress
    if (progressMade <= 0) return 0
    const msPerPercent = elapsedMs / progressMade
    const remaining = 100 - boundedProgress
    const etaSec = Math.round((msPerPercent * remaining) / 1000)
    // Cap at 15 min to avoid absurd estimates early in the pipeline
    return Math.min(etaSec, 900)
  }, [boundedProgress])

  const isWaitingForQuota = stageName.toLowerCase().includes("waiting for ai quota")

  return (
    <div className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center pt-20">
      <div className="w-full max-w-3xl">
        <div className="mb-9 text-center">
          <p className="mb-3 text-[0.65rem] uppercase text-(--cream-40)">
            Analysis in progress
          </p>
          <h1 className="font-serif text-4xl text-(--fg)">
            Reading the athlete&apos;s movement
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-(--cream-40)">
            Detecting body position, scoring key events, and preparing the annotated video.
          </p>
        </div>

        {currentStageIndex === 0 && (
          <div className="mb-5 border border-(--cream-10) bg-(--cream-03) p-4">
            <p className="text-sm text-(--cream-40)">Queued and waiting for analysis capacity.</p>
          </div>
        )}

        {isWaitingForQuota && (
          <div className="mb-5 border border-(--red) bg-red-500/10 p-4">
            <p className="text-sm text-(--fg)">AI capacity is busy. Retrying automatically.</p>
          </div>
        )}

        <div className="flex flex-col gap-8 border border-(--cream-10) bg-(--bg) p-6 sm:p-8">
          <div className="flex flex-col gap-5 border border-(--cream-05) bg-(--cream-03) p-5 sm:p-6">
            <div className="flex min-h-10 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between" aria-live="polite">
              {boundedProgress === 100 ? (
                <span className="inline-flex items-center gap-2 text-(--fg)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                    <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                  <span>Analysis complete</span>
                </span>
              ) : (
                <span className="text-sm uppercase text-(--cream-40)">Current stage</span>
              )}
              <span className="font-serif text-3xl tabular-nums text-(--fg)">
                {Math.trunc(boundedProgress)}%
              </span>
            </div>

            <div className="flex h-2 w-full items-center overflow-hidden bg-(--cream-05)">
              <div
                role="progressbar"
                className="flex items-center justify-center self-stretch bg-(--fg) transition-[width] duration-500 ease-out"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={boundedProgress}
                style={{ width: `${boundedProgress}%` }}
              ></div>
            </div>

            <div className="flex flex-col gap-2 text-xs uppercase text-(--cream-40) sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
              <span>{stageName}</span>
              <span>{estimatedSeconds > 0 ? `ETA ${estimatedSeconds}s` : 'Timing estimate pending'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STAGES.map((stage, index) => {
              const isCompleted = index < currentStageIndex
              const isActive = index === currentStageIndex

              return (
                <div 
                  key={index} 
                  className={`flex min-h-16 items-center gap-4 border p-3 transition-colors ${
                    isActive 
                      ? 'bg-(--cream-05) border-(--fg)' 
                      : isCompleted
                        ? 'bg-(--cream-05) border-(--cream-10)'
                        : 'bg-transparent border-(--cream-05) opacity-60'
                  }`}
                >
                  <div className={`shrink-0 w-10 h-10 flex items-center justify-center border text-xs tabular-nums transition-colors ${
                    isActive
                      ? 'bg-(--fg) text-(--bg) border-(--fg)'
                      : isCompleted
                        ? 'bg-(--cream-05) text-(--fg) border-(--cream-20)'
                        : 'bg-transparent text-(--cream-40) border-(--cream-05)'
                  }`}>
                    {isCompleted ? 'OK' : stage.label}
                  </div>
                  <span className={`text-sm tracking-wide ${
                    isActive ? 'text-(--fg) font-semibold' :
                    isCompleted ? 'text-(--cream-40)' : 'text-(--cream-40) font-medium'
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
