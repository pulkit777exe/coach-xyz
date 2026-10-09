'use client'

import { useRef, useEffect, useMemo, useState } from 'react'
import { ProgressBar } from '@/components/interior/progress-bar'
import type { JobStatus } from '@/types'

interface AnalysisProgressProps {
  status: JobStatus | null
}

const STAGES = [
  { name: 'Queued', label: '01' },
  { name: 'Detecting Players', label: '02' },
  { name: 'Analyzing Technique', label: '03' },
  { name: 'Rendering Video', label: '04' },
  { name: 'Complete', label: '05' },
]

export default function AnalysisProgress({ status }: AnalysisProgressProps) {
  const progress = status?.progress ?? 0
  const stageName = status?.stage_name ?? 'Queued'
  const maxProgress = status?.complete ? 100 : 99
  const boundedProgress = Math.max(0, Math.min(maxProgress, progress))
  const lastProgressRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  const currentStageIndex = useMemo(() => {
    const idx = STAGES.findIndex((s) => stageName.toLowerCase().startsWith(s.name.toLowerCase()))
    if (idx >= 0) return idx
    if (stageName.toLowerCase().includes('queue')) return 0
    if (stageName.toLowerCase().includes('detect')) return 1
    if (stageName.toLowerCase().includes('analy')) return 2
    if (stageName.toLowerCase().includes('render')) return 3
    if (stageName.toLowerCase().includes('complete')) return 4
    return Math.min(status?.stage ?? 0, STAGES.length - 1)
  }, [stageName, status?.stage])

  const [startMark, setStartMark] = useState<{ progress: number; time: number } | null>(null)

  useEffect(() => {
    if (boundedProgress > 0 && boundedProgress < 100) {
      lastProgressRef.current = boundedProgress
      lastTimeRef.current = Date.now()
    }
  }, [boundedProgress])

  useEffect(() => {
    if (startMark || boundedProgress <= 0 || boundedProgress >= 100) return
    const t = setTimeout(() => setStartMark({ progress: boundedProgress, time: Date.now() }), 0)
    return () => clearTimeout(t)
  }, [boundedProgress, startMark])

  const [now, setNow] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const estimatedSeconds = useMemo(() => {
    if (boundedProgress <= 0 || boundedProgress >= 100) return 0
    if (!startMark) return 0
    const elapsedMs = now - startMark.time
    const progressMade = boundedProgress - startMark.progress
    if (progressMade <= 0) return 0
    const msPerPercent = elapsedMs / progressMade
    const remaining = 100 - boundedProgress
    const etaSec = Math.round((msPerPercent * remaining) / 1000)
    return Math.min(etaSec, 900)
  }, [boundedProgress, startMark, now])

  const isWaitingForQuota = stageName.toLowerCase().includes('waiting for ai quota')

  return (
    <div className="min-h-screen bg-transparent p-6 flex flex-col items-center justify-center pt-20">
      <div className="w-full max-w-3xl">
        <div className="mb-9 text-center">
          <p className="mb-3 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Analysis in progress
          </p>
          <h1 className="text-[26px] sm:text-[30px] font-bold tracking-[-0.015em] text-foreground">
            Reading the athlete&apos;s movement
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-body leading-6 text-muted-foreground">
            Detecting body position, scoring key events, and preparing the annotated video.
          </p>
        </div>

        {currentStageIndex === 0 && (
          <div className="mb-5 border border-border bg-muted rounded-[6px] p-4">
            <p className="text-body leading-5 text-muted-foreground">
              Queued and waiting for analysis capacity.
            </p>
          </div>
        )}

        {isWaitingForQuota && (
          <div className="mb-5 border border-destructive/20 bg-destructive/10 rounded-[6px] p-4">
            <p className="text-body text-destructive">
              AI capacity is busy. Retrying automatically.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-8 border border-border bg-card rounded-[6px] p-6 sm:p-8">
          <div className="flex flex-col gap-5 border border-border bg-muted rounded-[6px] p-5 sm:p-6">
            {boundedProgress === 100 && (
              <div className="flex items-center gap-2 text-foreground" aria-live="polite">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-6 shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Analysis complete</span>
              </div>
            )}

            <ProgressBar
              value={boundedProgress}
              label={stageName}
              completeLabel="Analysis complete"
            />

            <div className="flex justify-end text-meta text-muted-foreground" aria-live="polite">
              <span className="tabular-nums">
                {boundedProgress >= 100
                  ? 'Finished'
                  : estimatedSeconds > 0
                    ? `ETA ${estimatedSeconds}s`
                    : 'Timing estimate pending'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STAGES.map((stage, index) => {
              const isCompleted = index < currentStageIndex
              const isActive = index === currentStageIndex

              return (
                <div
                  key={index}
                  className={`flex min-h-16 items-center gap-4 rounded-[6px] border p-3 transition-colors ${
                    isActive
                      ? 'bg-primary/10 border-primary'
                      : isCompleted
                        ? 'bg-muted border border-border'
                        : 'bg-transparent border border-border opacity-60'
                  }`}
                >
                  <div
                    className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-[6px] border text-caption leading-4 font-medium tabular-nums transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary'
                        : isCompleted
                          ? 'bg-accent text-foreground border-border'
                          : 'bg-transparent text-muted-foreground border-border'
                    }`}
                  >
                    {isCompleted ? 'OK' : stage.label}
                  </div>
                  <span
                    className={`text-body ${
                      isActive
                        ? 'text-foreground font-semibold'
                        : isCompleted
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground font-medium'
                    }`}
                  >
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
