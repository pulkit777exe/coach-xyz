'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface PollOption {
  id: string
  label: string
  votes: number
}

interface PollResultsProps {
  label: string
  options: PollOption[]
  onVote: (id: string) => void
  className?: string
}

export function PollResults({ label, options, onVote, className }: PollResultsProps) {
  const [votes, setVotes] = useState<Record<string, number>>(
    Object.fromEntries(options.map((o) => [o.id, o.votes])),
  )
  const [votedId, setVotedId] = useState<string | null>(null)
  const total = Object.values(votes).reduce((a, b) => a + b, 0)

  const vote = (id: string) => {
    if (votedId) return
    setVotes((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }))
    setVotedId(id)
    onVote(id)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {options.map((option) => {
        const count = votes[option.id] ?? 0
        const pct = total > 0 ? (count / total) * 100 : 0
        const active = votedId === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => vote(option.id)}
            disabled={!!votedId}
            className="relative block w-full cursor-pointer overflow-hidden rounded-[6px] border border-border px-4 py-3 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span
              className="absolute inset-y-0 left-0 bg-muted transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
            <span className="relative flex items-center justify-between gap-3 text-[14px] text-foreground">
              <span>
                {option.label}
                {active && <span className="ml-2 text-success">✓</span>}
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                {count} ({pct.toFixed(0)}%)
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
