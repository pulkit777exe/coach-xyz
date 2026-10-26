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
        className="cursor-pointer rounded-[4px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}
