'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <h2 className="text-[var(--fg)] text-xl font-semibold mb-4">Something went wrong</h2>
        <p className="text-[var(--cream-40)] mb-6">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        {error?.digest && (
          <p className="text-zinc-500 text-sm mb-4">Error ID: {error.digest}</p>
        )}
        <Button
          onClick={reset}
          size="lg"
        >
          Try again
        </Button>
      </div>
    </div>
  )
}
