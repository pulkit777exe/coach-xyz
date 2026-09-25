'use client'

import { cn } from '@/lib/utils'

interface TimestampPillProps {
  /** Seconds into the video. */
  seconds: number
  /** Clock format renders m:ss.s (chat refs); short renders 12.5s. */
  format?: 'short' | 'clock'
  /** When provided the pill seeks the video — the product signature. */
  onSeek?: (seconds: number) => void
  className?: string
}

export function formatTimestampShort(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

export function formatTimestampClock(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

export default function TimestampPill({
  seconds,
  format = 'short',
  onSeek,
  className,
}: TimestampPillProps) {
  const label = format === 'clock' ? formatTimestampClock(seconds) : formatTimestampShort(seconds)
  // Notion-style reference pill: soft primary tint, full radius, 11px/500.
  const styles =
    'inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-label font-medium tabular-nums text-primary'
  if (!onSeek) {
    return <span className={cn(styles, className)}>{label}</span>
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(seconds)}
      aria-label={`Seek to ${label}`}
      className={cn(
        styles,
        'transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]',
        className,
      )}
    >
      <svg
        className="size-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {label}
    </button>
  )
}
