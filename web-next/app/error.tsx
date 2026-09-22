'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

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
    <main className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-danger/10 text-destructive">
          <TriangleAlert className="size-6" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        {error?.digest && (
          <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-6">
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  )
}
