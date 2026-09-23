'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

/** Blue text-button primary action (important overrides the ghost variant deterministically). */
const ACTION_PRIMARY =
  'h-auto! px-1 text-sm font-medium text-primary! transition-colors hover:bg-transparent! hover:text-primary/80!'
/** Muted secondary text-button. */
const ACTION_SECONDARY =
  'h-auto! px-1 text-sm font-medium text-muted-foreground! transition-colors hover:bg-transparent! hover:text-foreground!'

export default function DashboardError({
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
    <div className="flex min-h-[70vh] items-center justify-center bg-background p-8 lg:p-12">
      <div className="w-full max-w-sm rounded-[8px] border border-border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-[11px] font-medium tracking-wider text-destructive uppercase">
          Error
        </p>
        <h2 className="mt-2 text-base font-medium text-foreground">Something went wrong</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        {error?.digest && (
          <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-col items-center gap-2">
          <Button variant="ghost" onClick={reset} className={ACTION_PRIMARY}>
            Try again
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className={ACTION_SECONDARY}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
