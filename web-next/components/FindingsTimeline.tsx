'use client'

import { useState } from 'react'
import { Button } from '@/components/9ui/ui/button'
import type { Finding } from '@/types'

interface FindingsTimelineProps {
  findings: Finding[]
  /** Seconds to seek the video to. Omitted = read-only list. */
  onSeek?: (seconds: number) => void
  /** Coach review handler. Shown only for unreviewed findings when provided. */
  onReview?: (findingId: string, reviewState: 'approved' | 'flagged') => Promise<void>
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'text-destructive bg-destructive/10 border-destructive/20',
  medium: 'text-warning bg-warning/10 border-warning/20',
  low: 'text-foreground bg-muted border-border',
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
  if (!findings || findings.length === 0) return null

  const review = async (id: string, state: 'approved' | 'flagged') => {
    if (!onReview || pending.has(id)) return
    setPending((prev) => new Set(prev).add(id))
    try {
      await onReview(id, state)
      setReviewed((prev) => ({ ...prev, [id]: state }))
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Key findings · {findings.length}
        </h3>
      </div>
      <ul className="max-h-64 overflow-y-auto px-3 pb-3 space-y-1">
        {findings.map((finding) => {
          const seconds = (finding.start_ms ?? 0) / 1000
          const override = reviewed[finding.id] as 'approved' | 'flagged' | undefined
          const state: string = override ?? finding.review_state ?? 'auto'
          const severityClass =
            SEVERITY_STYLE[finding.severity ?? ''] ?? SEVERITY_STYLE.medium
          const isPending = pending.has(finding.id)
          const showReview =
            onReview && (state === 'auto' || state === 'needs_review')
          return (
            <li key={finding.id}>
              <div
                className={`w-full text-left rounded-xl border border-transparent px-3 py-2.5 transition-colors ${
                  onSeek ? 'hover:bg-muted' : ''
                }`}
              >
                <button
                  type="button"
                  disabled={!onSeek}
                  onClick={() => onSeek?.(seconds)}
                  className={`w-full text-left ${onSeek ? 'cursor-pointer' : 'cursor-default'}`}
                  aria-label={`${finding.category} at ${seconds.toFixed(1)} seconds`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                      {seconds.toFixed(1)}s
                    </span>
                    <span className={`text-[0.65rem] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border ${severityClass}`}>
                      {finding.severity ?? 'medium'}
                    </span>
                    <span className="text-[0.65rem] text-muted-foreground">
                      {BAND_LABEL[finding.confidence_band ?? ''] ?? finding.confidence_band}
                    </span>
                    {state === 'needs_review' && (
                      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-warning">
                        Needs review
                      </span>
                    )}
                    {state === 'approved' && (
                      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-primary">
                        Approved
                      </span>
                    )}
                    {state === 'flagged' && (
                      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-destructive">
                        Flagged
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground leading-snug capitalize">
                    {(finding.category ?? 'technique').replace(/_/g, ' ')}
                  </p>
                  {finding.observation && (
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {finding.observation}
                    </p>
                  )}
                </button>
                {showReview && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-lg text-xs font-semibold"
                      disabled={isPending}
                      onClick={() => review(finding.id, 'approved')}
                    >
                      {isPending ? 'Saving…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-lg text-xs font-semibold text-destructive border-destructive/30"
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
