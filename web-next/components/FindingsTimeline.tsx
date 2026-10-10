'use client'

import { useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import TimestampPill from '@/components/TimestampPill'
import { errorMessageOf } from '@/lib/errors'
import type { Finding } from '@/types'

interface FindingsTimelineProps {
  findings: Finding[]
  /** Seconds to seek the video to. Omitted = read-only list. */
  onSeek?: (seconds: number) => void
  /** Coach review handler. Shown only for unreviewed findings when provided. */
  onReview?: (findingId: string, reviewState: 'approved' | 'flagged') => Promise<void>
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'text-destructive bg-destructive/10',
  medium: 'text-warning bg-warning/15',
  low: 'text-muted-foreground bg-muted',
}

const BAND_LABEL: Record<string, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  needs_review: 'Needs review',
}

export default function FindingsTimeline({ findings, onSeek, onReview }: FindingsTimelineProps) {
  // Local review overrides keyed by finding id — props stay the server
  // truth; overrides apply on top so polling never clobbers a just-made
  // decision before the next fetch.
  const [reviewed, setReviewed] = useState<Record<string, 'approved' | 'flagged'>>({})
  const [pending, setPending] = useState<Set<string>>(new Set())
  /**
   * The last review WRITE that did not happen. `onReview` is an awaited network call and
   * both call sites pass a promise straight into an `onClick`, so before this existed a
   * rejection escaped `review`'s `try`, surfaced as an unhandled promise rejection, and
   * told the coach nothing: the button simply stopped reading "Saving…" for a decision
   * that was never recorded.
   */
  const [reviewError, setReviewError] = useState<string | null>(null)
  if (!findings || findings.length === 0) return null

  const review = async (id: string, state: 'approved' | 'flagged') => {
    if (!onReview || pending.has(id)) return
    setReviewError(null)
    setPending((prev) => new Set(prev).add(id))
    try {
      await onReview(id, state)
      setReviewed((prev) => ({ ...prev, [id]: state }))
    } catch (err) {
      // `reviewed` is deliberately NOT advanced — the local override would claim a
      // decision the server never took. The `finally` only releases the spinner.
      setReviewError(errorMessageOf(err, 'Your review could not be saved. Try again.'))
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="rounded-[6px] border border-border bg-card">
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-meta font-medium text-muted-foreground">
          Key findings · <span className="tabular-nums">{findings.length}</span>
        </h3>
      </div>
      {reviewError && (
        <p role="alert" className="mx-5 mb-2 text-caption leading-[1.5] text-destructive">
          {reviewError}
        </p>
      )}
      <ul className="max-h-64 overflow-y-auto px-3 pb-3 space-y-1">
        {findings.map((finding) => {
          const seconds = (finding.start_ms ?? 0) / 1000
          const override = reviewed[finding.id] as 'approved' | 'flagged' | undefined
          const state: string = override ?? finding.review_state ?? 'auto'
          const severityClass = SEVERITY_STYLE[finding.severity ?? ''] ?? SEVERITY_STYLE.medium
          const isPending = pending.has(finding.id)
          const showReview = onReview && (state === 'auto' || state === 'needs_review')
          return (
            <li key={finding.id}>
              <div
                className={`w-full text-left rounded-[4px] border border-transparent px-3 py-2.5 transition-colors ${
                  onSeek ? 'hover:bg-accent' : ''
                }`}
              >
                <button
                  type="button"
                  disabled={!onSeek}
                  onClick={() => onSeek?.(seconds)}
                  className={`w-full text-left rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${onSeek ? 'cursor-pointer' : 'cursor-default'}`}
                  aria-label={`${finding.category} at ${seconds.toFixed(1)} seconds`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <TimestampPill seconds={seconds} />
                    <span
                      className={`text-label font-medium px-2 py-0.5 rounded-full ${severityClass}`}
                    >
                      {finding.severity ?? 'medium'}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {BAND_LABEL[finding.confidence_band ?? ''] ?? finding.confidence_band}
                    </span>
                    {state === 'needs_review' && (
                      <span className="text-caption font-medium text-warning">Needs review</span>
                    )}
                    {state === 'approved' && (
                      <span className="text-caption font-medium text-primary">Approved</span>
                    )}
                    {state === 'flagged' && (
                      <span className="text-caption font-medium text-destructive">Flagged</span>
                    )}
                  </div>
                  <p className="text-body text-foreground leading-snug capitalize">
                    {(finding.category ?? 'technique').replace(/_/g, ' ')}
                  </p>
                  {finding.observation && (
                    <p className="text-meta text-muted-foreground leading-[1.5] mt-0.5">
                      {finding.observation}
                    </p>
                  )}
                </button>
                {showReview && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-[6px] text-caption font-medium"
                      disabled={isPending}
                      onClick={() => review(finding.id, 'approved')}
                    >
                      {isPending ? 'Saving…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-[6px] text-caption font-medium text-destructive border-destructive/30"
                      disabled={isPending}
                      onClick={() => review(finding.id, 'flagged')}
                    >
                      {isPending ? 'Saving…' : 'Flag'}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
