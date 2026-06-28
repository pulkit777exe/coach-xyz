'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import type { CoachAIError } from '@/lib/api'

interface ErrorScreenProps {
  error: CoachAIError
  onRetry: () => void
}

// ── Error Details Map ────────────────────────────────────────────────────────
// Maps error codes to user-friendly details: title, description, and whether to retry.

const ERROR_DETAILS: Record<string, { title: string; description: string; action?: string }> = {
  // Client errors
  INVALID_TYPE: {
    title: 'Invalid File',
    description: 'The file you selected is not a video.',
    action: 'Select a video file (MP4, MOV, AVI).',
  },
  FILE_TOO_LARGE: {
    title: 'File Too Large',
    description: 'The video exceeds the 500MB size limit.',
    action: 'Compress your video or use a shorter clip.',
  },
  NETWORK_ERROR: {
    title: 'Connection Lost',
    description: 'Cannot reach the server.',
    action: 'Check your internet connection and try again.',
  },

  // Server errors
  RATE_LIMITED: {
    title: 'Rate Limited',
    description: 'Too many requests.',
    action: 'Wait a moment and try again.',
  },
  INVALID_BETA_CODE: {
    title: 'Access Denied',
    description: 'Your beta code is invalid or expired.',
    action: 'Enter a valid beta code.',
  },
  QUEUE_UNAVAILABLE: {
    title: 'Service Unavailable',
    description: 'The job queue is not configured.',
    action: 'Try again later.',
  },

  // Engine errors
  NO_PLAYERS_DETECTED: {
    title: 'No Players Found',
    description: 'Could not detect any players in the video.',
    action: 'Try a video with clearer player visibility or better lighting.',
  },
  VIDEO_DECODE_FAILED: {
    title: 'Video Error',
    description: 'Could not read the video file.',
    action: 'Try a different video format (MP4, MOV, AVI).',
  },
  GEMINI_QUOTA_EXCEEDED: {
    title: 'AI Quota Reached',
    description: 'The AI service has reached its limit.',
    action: 'Wait a few minutes and try again.',
  },
  GEMINI_TIMEOUT: {
    title: 'Analysis Timed Out',
    description: 'The AI analysis took too long.',
    action: 'Try a shorter video clip.',
  },
  GEMINI_PARSE_FAILED: {
    title: 'Analysis Error',
    description: 'The AI returned an unexpected response.',
    action: 'Try again — this usually resolves on retry.',
  },
  JOB_NOT_FOUND: {
    title: 'Session Expired',
    description: 'The analysis session has expired or was not found.',
    action: 'Upload your video again.',
  },
  ENGINE_UNAVAILABLE: {
    title: 'Engine Unavailable',
    description: 'The analysis engine is temporarily offline.',
    action: 'Try again in a few minutes.',
  },
  INVALID_STATE_TRANSITION: {
    title: 'Unexpected State',
    description: 'The analysis is in an unexpected state.',
    action: 'Try again from the beginning.',
  },
  MEDIAPIPE_UNAVAILABLE: {
    title: 'Detection Unavailable',
    description: 'Player detection service is unavailable.',
    action: 'Try again shortly.',
  },
  STORAGE_ERROR: {
    title: 'Storage Error',
    description: 'Failed to save or retrieve the video.',
    action: 'Try again.',
  },
  ANALYSIS_FAILED: {
    title: 'Analysis Failed',
    description: 'The analysis failed after multiple attempts.',
    action: 'Try again with a different video.',
  },
  ANALYSIS_TIMEOUT: {
    title: 'Analysis Timed Out',
    description: 'The analysis is taking longer than expected.',
    action: 'The job may still complete — try refreshing in a few minutes.',
  },
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const stableOnRetry = useCallback(onRetry, [onRetry])

  useEffect(() => {
    if (error.code === 'RATE_LIMITED' && error.retry_after && error.retry_after > 0) {
      setCountdown(error.retry_after)

      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            setTimeout(stableOnRetry, 100)
            return null
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [error.code, error.retry_after, stableOnRetry])

  const details = ERROR_DETAILS[error.code] ?? {
    title: 'Something Went Wrong',
    description: error.message,
    action: error.retryable ? 'Try again.' : 'Contact support if this persists.',
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <svg
          className="w-16 h-16 mx-auto mb-6 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        <h1 className="text-2xl font-semibold text-white mb-3">
          {details.title}
        </h1>

        <p className="text-gray-400 mb-2">{details.description}</p>

        {details.action && (
          <p className="text-sm text-gray-500 mb-2">{details.action}</p>
        )}

        <p className="text-xs text-gray-600 mb-8">
          Error: {error.code} | Layer: {error.layer}
        </p>

        {countdown !== null && (
          <p className="text-sm text-indigo-400 mb-4 animate-pulse">
            Retrying in {countdown} seconds...
          </p>
        )}

        {error.retryable ? (
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            size="lg"
            onClick={onRetry}
            disabled={countdown !== null}
          >
            {countdown !== null ? `Wait ${countdown}s...` : 'Try Again'}
          </Button>
        ) : (
          <p className="text-sm text-gray-500">
            This error cannot be retried. Please{' '}
            <a href="mailto:support@coachai.dev" className="text-indigo-400 underline">
              contact support
            </a>
            .
          </p>
        )}
      </div>
    </div>
  )
}
