'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

/** Blue text-button action — important keeps the override deterministic vs the ghost variant. */
const ACTION_PRIMARY =
  'h-auto! px-1 text-sm font-medium text-primary! transition-colors hover:bg-transparent! hover:text-primary/80!'

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
    <main id="main" tabIndex={-1} className="flex min-h-[70vh] items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-[8px] border border-border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-[11px] font-medium tracking-wider text-destructive uppercase">
          Error
        </p>
        <h1 className="mt-2 text-base font-medium text-foreground">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        {error?.digest && (
          <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-5">
          <Button variant="ghost" onClick={reset} className={ACTION_PRIMARY}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  )
}
