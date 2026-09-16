'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

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
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-xl bg-danger/10 text-destructive">
          <TriangleAlert className="size-7" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-foreground">Analysis failed</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {error?.message || 'Failed to load analysis. Please try again.'}
        </p>
        {error?.digest && (
          <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" render={<Link href="/dashboard/history" />}>Back to history</Button>
        </div>
      </div>
    </div>
  )
}