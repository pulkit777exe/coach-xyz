'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'

export default function HistoryError({
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
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="border border-(--red) p-8">
        <h2 className="text-(--fg) text-xl font-semibold mb-4">Failed to load history</h2>
        <p className="text-(--cream-40) mb-6">
          {error?.message || 'An error occurred while loading your analysis history.'}
        </p>
        {error?.digest && (
          <p className="text-zinc-500 text-sm mb-4">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-4">
          <button
            onClick={reset}
            className="px-6 py-3 border border-(--cream-10) text-(--fg) text-[0.65rem] uppercase tracking-[0.2em] transition-all hover:bg-(--fg) hover:text-(--bg)"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-3 border border-(--cream-10) text-(--cream-40) text-[0.65rem] uppercase tracking-[0.2em] transition-all hover:text-(--fg) hover:border-(--cream-20)"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
