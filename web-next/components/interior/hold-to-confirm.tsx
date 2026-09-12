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
      className={cn(
        'inline-flex cursor-pointer select-none items-center gap-2 border border-(--red) bg-transparent text-[0.65rem] uppercase tracking-[0.15em] text-(--red) transition-colors',
        armed && 'bg-(--red) text-(--bg)',
        className,
      )}
    >
      {children}
      {armed && <span className="animate-pulse">{confirmLabel}</span>}
    </button>
  )
}