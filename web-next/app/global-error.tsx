'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
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
    <html>
      <body style={{ margin: 0 }}>
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="w-full max-w-sm rounded-[8px] border border-border bg-card p-6 text-center">
            <p className="text-[40px] leading-none font-bold text-muted-foreground">C</p>
            <h1 className="mt-4 text-base font-medium text-foreground">Something went wrong</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {error.message || 'An unexpected error occurred.'}
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-[4px] px-1 text-sm font-medium text-primary outline-none transition-colors duration-150 hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = window.location.origin + '/'
                }}
                className="rounded-[4px] px-1 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
