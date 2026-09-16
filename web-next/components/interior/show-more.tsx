'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ShowMoreProps {
  lines: number
  children: React.ReactNode
  className?: string
}

export function ShowMore({ lines, children, className }: ShowMoreProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn(!expanded && 'overflow-hidden')}
        style={
          expanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
              }
        }
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}