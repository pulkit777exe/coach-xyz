'use client'

import { useRef, useEffect } from 'react'
import type { JobStatus } from '@/types'
import { Progress } from './ui/progress'

interface AnalysisProgressProps {
  status: JobStatus | null
}

const STAGES = [
  "Uploading",
  "Extracting Frames",
  "Detecting Players",
  "Analyzing Technique",
  "Generating Feedback",
  "Rendering Video"
]

export default function AnalysisProgress({ status }: AnalysisProgressProps) {
  const currentStage = status?.stage ?? 0
  const progress = status?.progress ?? 0
  const lastProgressRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(Date.now())

  // Calculate estimated time remaining
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

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center">
      <div className="max-w-2xl w-full">
        <h1 className="text-3xl font-bold text-white mb-8">
          Analyzing your video...
        </h1>

        {/* Stage Stepper */}
        <div className="mb-8 space-y-4">
          {STAGES.map((stage, index) => {
            const isCompleted = index < currentStage
            const isActive = index === currentStage
            const isPending = index > currentStage

            return (
              <div key={index} className="flex items-center gap-4">
                {/* Status Indicator */}
                <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center">
                  {isCompleted ? (
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-sm">
                      ✓
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 rounded-full bg-indigo-500 animate-pulse" />
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-gray-600" />
                  )}
                </div>

                {/* Stage Text */}
                <span className={`text-sm font-medium ${
                  isActive ? 'text-indigo-400 font-bold' :
                  isCompleted ? 'text-green-400' : 'text-gray-500'
                }`}>
                  {stage}
                </span>
              </div>
            )
          })}
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <Progress value={progress} className="h-2 bg-gray-800" />
        </div>

        <div className="text-center mb-2">
          <p className="text-lg font-semibold text-white">
            {progress}% complete
          </p>
        </div>

        {/* Estimated Time */}
        {progress > 0 && progress < 100 && (
          <div className="text-center">
            <p className="text-sm text-gray-400">
              Estimated time remaining: ~{estimatedSeconds()}s
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
