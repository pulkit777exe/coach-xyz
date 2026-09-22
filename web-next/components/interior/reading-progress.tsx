'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface ReadingProgressProps {
  scroller?: { current: HTMLElement | null }
  className?: string
}

export function ReadingProgress({ scroller, className }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const update = () => {
      const el = scroller?.current
      let pct = 0
      if (el) {
        const max = el.scrollHeight - el.clientHeight
        pct = max > 0 ? el.scrollTop / max : 0
      } else {
        const doc = document.documentElement
        const max = doc.scrollHeight - doc.clientHeight
        pct = max > 0 ? window.scrollY / max : 0
      }
      setProgress(Math.min(1, Math.max(0, pct)))
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [scroller])

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={cn('pointer-events-none h-0.5 bg-muted', className)}
    >
      <div
        className="h-full bg-primary transition-[width] duration-150"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  )
}
