'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'

export default function AnalysisError({
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
    <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <svg className="w-16 h-16 mx-auto mb-6 text-(--red)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h1 className="text-2xl font-semibold text-(--fg) mb-3">Analysis Error</h1>
        <p className="text-(--cream-40) mb-6">
          {error?.message || 'Failed to load analysis. Please try again.'}
        </p>
        {error?.digest && (
          <p className="text-zinc-500 text-sm mb-4">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 border border-(--cream-10) text-(--fg) text-sm uppercase tracking-[0.15em] hover:bg-(--fg) hover:text-(--bg) transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard/history"
            className="px-6 py-3 border border-(--cream-10) text-(--cream-40) text-sm uppercase tracking-[0.15em] hover:text-(--fg) hover:border-(--cream-20) transition-colors"
          >
            Back to History
          </Link>
        </div>
      </div>
    </div>
  )
}
