'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface HoldToConfirmProps {
  onConfirm: () => void
  confirmLabel: string
  children: React.ReactNode
  className?: string
  holdMs?: number
}

export function HoldToConfirm({
  onConfirm,
  confirmLabel,
  children,
  className,
  holdMs = 900,
}: HoldToConfirmProps) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = () => {
    setArmed(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setArmed(false)
      timer.current = null
      onConfirm()
    }, holdMs)
  }

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setArmed(false)
  }

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboard hold-to-confirm: holding Enter/Space mirrors pointer hold.
      // Prevent key-repeat re-arming and release activation.
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (!e.repeat && !timer.current) start()
      }}
      onKeyUp={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        cancel()
      }}
      onBlur={cancel}
      aria-describedby="hold-to-confirm-hint"
      className={cn(
        'inline-flex cursor-pointer select-none items-center gap-2 border border-danger/30 bg-transparent text-[0.65rem] uppercase tracking-[0.15em] text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        armed && 'bg-danger text-danger-foreground',
        className,
      )}
    >
      {children}
      {armed && <span className="animate-pulse">{confirmLabel}</span>}
      <span id="hold-to-confirm-hint" className="sr-only">
        Press and hold to confirm
      </span>
    </button>
  )
}
