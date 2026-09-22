'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

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
    <div className="p-8 lg:p-12">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-danger/10 text-destructive">
          <TriangleAlert className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-foreground">Failed to load history</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message || 'An error occurred while loading your analysis history.'}
        </p>
        {error?.digest && (
          <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
