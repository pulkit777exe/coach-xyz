'use client'

import type { Finding } from '@/types'

interface FindingsTimelineProps {
  findings: Finding[]
  /** Seconds to seek the video to. Omitted = read-only list. */
  onSeek?: (seconds: number) => void
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

export default function FindingsTimeline({ findings, onSeek }: FindingsTimelineProps) {
  if (!findings || findings.length === 0) return null

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
          const severityClass =
            SEVERITY_STYLE[finding.severity ?? ''] ?? SEVERITY_STYLE.medium
          return (
            <li key={finding.id}>
              <button
                type="button"
                disabled={!onSeek}
                onClick={() => onSeek?.(seconds)}
                className={`w-full text-left rounded-xl border border-transparent px-3 py-2.5 transition-colors ${
                  onSeek ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
                }`}
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
                  {finding.review_state === 'needs_review' && (
                    <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-warning">
                      Needs review
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
