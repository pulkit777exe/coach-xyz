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
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#16120f',
            color: '#f0ebe1',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '28rem', padding: '1.5rem' }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: '3rem',
                height: '3rem',
                borderRadius: '0.5rem',
                backgroundColor: 'rgba(188,245,108,0.1)',
                color: '#BCF56C',
                fontSize: '0.75rem',
                fontWeight: 700,
                margin: '0 auto 1rem',
              }}
            >
              C
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Something went wrong
            </h1>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'rgba(240,235,225,0.4)',
                marginBottom: '0.5rem',
              }}
            >
              {error.message || 'An unexpected error occurred.'}
            </p>
            {error.digest && (
              <p
                style={{
                  color: 'rgba(240,235,225,0.25)',
                  fontSize: '0.75rem',
                  marginBottom: '1.5rem',
                }}
              >
                Error ID: {error.digest}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={reset}
                style={{
                  backgroundColor: '#BCF56C',
                  color: '#13160f',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                }}
              >
                Try again
              </button>
              <button
                onClick={() => {
                  window.location.href = window.location.origin + '/'
                }}
                style={{
                  backgroundColor: 'transparent',
                  color: '#f0ebe1',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '9999px',
                  fontWeight: 500,
                  border: '1px solid rgba(240,235,225,0.15)',
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                }}
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
