'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import type { CoachAIError } from '@/lib/api'

interface ErrorScreenProps {
  error: CoachAIError
  onRetry: () => void
}

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
            // Auto-retry when countdown reaches 0
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

        <h1 className="text-2xl font-semibold text-white mb-4">
          Something went wrong
        </h1>

        <p className="text-gray-400 mb-4">{error.message}</p>

        <p className="text-sm text-gray-600 mb-8">
          Error: {error.code}
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
            This won&apos;t work automatically. Please{' '}
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
