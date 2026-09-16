'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/9ui/ui/button'
import type { CoachAIError } from '@/lib/api'

interface ErrorScreenProps {
  error: CoachAIError
  onRetry: () => void
}

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
  REQUEST_FAILED: {
    title: 'Request Failed',
    description: 'The request could not be completed.',
    action: 'Check your connection and try again.',
  },

  RATE_LIMITED: {
    title: 'Rate Limited',
    description: 'Too many requests.',
    action: 'Wait a moment and try again.',
  },
  QUEUE_UNAVAILABLE: {
    title: 'Service Unavailable',
    description: 'The job queue is not configured.',
    action: 'Try again later.',
  },
  INVALID_REQUEST: {
    title: 'Invalid Request',
    description: 'The request format is invalid.',
    action: 'Try again with a valid request.',
  },
  NO_FILE: {
    title: 'No File Provided',
    description: 'No video file was provided.',
    action: 'Select a video file to upload.',
  },
  INVALID_FILE_TYPE: {
    title: 'Invalid File Type',
    description: 'The uploaded file is not a video.',
    action: 'Select a video file (MP4, MOV, AVI).',
  },
  INVALID_SESSION_TOKEN: {
    title: 'Invalid Session',
    description: 'The session token is invalid.',
    action: 'Upload your video again.',
  },
  INVALID_PLAYER_INDEX: {
    title: 'Invalid Player',
    description: 'The player selection is invalid.',
    action: 'Select a valid player.',
  },

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
  VIDEO_EXPIRED: {
    title: 'Video Expired',
    description: 'The video is no longer available.',
    action: 'Upload your video again.',
  },
  VIDEO_NOT_FOUND: {
    title: 'Video Not Available',
    description: 'The rendered video is not available yet.',
    action: 'Try again in a moment.',
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
  GEMINI_PROCESSING_FAILED: {
    title: 'AI Processing Error',
    description: 'The AI failed to process the video.',
    action: 'Try again with a different video clip.',
  },
  REQUEST_TIMEOUT: {
    title: 'Request Timed Out',
    description: 'The request took too long to complete.',
    action: 'Check your connection and try again.',
  },
  REDIS_UNAVAILABLE: {
    title: 'Service Unavailable',
    description: 'Job storage is temporarily unavailable.',
    action: 'Try again in a few minutes.',
  },
  INTERNAL_ERROR: {
    title: 'Internal Error',
    description: 'An unexpected server error occurred.',
    action: 'Try again or contact support if this persists.',
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
  CONNECTION_REFUSED: {
    title: 'Connection Refused',
    description: 'The server refused the connection.',
    action: 'Check that the backend server is running and try again.',
  },
  ENGINE_ERROR: {
    title: 'Engine Error',
    description: 'The analysis engine encountered an error.',
    action: 'Try again or contact support.',
  },
  UNKNOWN: {
    title: 'Unknown Error',
    description: 'An unknown error occurred.',
    action: 'Try again or contact support.',
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


export default function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const stableOnRetry = useCallback(() => onRetry(), [onRetry])

  // Initialize the countdown when a rate-limit error appears/changes. Done via
  // render-time state adjustment (the documented alternative to a sync
  // setState-in-effect); the interval below only ticks it down.
  const rateLimitKey = `${error.code}:${error.retry_after ?? ''}`
  const [prevRateLimitKey, setPrevRateLimitKey] = useState(rateLimitKey)
  if (prevRateLimitKey !== rateLimitKey) {
    setPrevRateLimitKey(rateLimitKey)
    setCountdown(
      error.code === 'RATE_LIMITED' && error.retry_after && error.retry_after > 0
        ? error.retry_after
        : null
    )
  }

  useEffect(() => {
    if (error.code === 'RATE_LIMITED' && error.retry_after && error.retry_after > 0) {
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            retryTimeoutRef.current = setTimeout(stableOnRetry, 100)
            return null
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    }
  }, [error.code, error.retry_after, stableOnRetry])

  const details = ERROR_DETAILS[error.code] ?? {
    title: 'Something Went Wrong',
    description: error.message,
    action: error.retryable ? 'Try again.' : 'Contact support if this persists.',
  }

  return (
    <>
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 pt-20">
        <div className="max-w-md w-full text-center">
          <svg
            className="w-16 h-16 mx-auto mb-6 text-destructive"
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

          <h1 className="text-2xl font-semibold text-foreground mb-3">
            {details.title}
          </h1>

          <p className="text-muted-foreground mb-2">{details.description}</p>

          {details.action && (
            <p className="text-sm text-muted-foreground mb-2">{details.action}</p>
          )}

          <p className="text-xs text-muted-foreground/60 mb-8">
            Error: {error.code} | Layer: {error.layer}
          </p>

          {countdown !== null && (
            <p className="text-sm text-foreground mb-4 animate-pulse">
              Retrying in {countdown} seconds...
            </p>
          )}

          {error.retryable ? (
            <Button
              size="lg"
              onClick={onRetry}
              disabled={countdown !== null}
            >
              {countdown !== null ? `Wait ${countdown}s...` : 'Try Again'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              This error cannot be retried. Please{' '}
              <a href="mailto:help@coachxyz.app" className="text-foreground underline">
                contact support
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </>
  )
}
