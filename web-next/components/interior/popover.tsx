'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PopoverProps {
  trigger?: 'click' | 'hover'
  label: string
  children: React.ReactNode
  className?: string
  side?: 'top' | 'bottom'
}

export function Popover({
  trigger = 'hover',
  label,
  children,
  className,
  side = 'top',
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  // Once shown, the tooltip stays mounted so closing can fade it out
  // (enter is instant; exit-only fade — per the interior-widget contract).
  const [everOpen, setEverOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  const show = () => {
    setEverOpen(true)
    setOpen(true)
  }

  useEffect(() => {
    if (trigger !== 'click') return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [trigger])

  return (
    <span
      ref={ref}
      className={cn('relative inline-flex', className)}
      onMouseEnter={trigger === 'hover' ? show : undefined}
      onMouseLeave={trigger === 'hover' ? () => setOpen(false) : undefined}
      onClick={trigger === 'click' ? () => setOpen((v) => !v) : undefined}
    >
      {children}
      {everOpen && (
        <span
          role="tooltip"
          aria-hidden={!open}
          className={cn(
            'absolute left-1/2 z-50 w-56 -translate-x-1/2 rounded-[6px] border border-border bg-popover p-3 text-[13px] leading-relaxed text-muted-foreground shadow-lg',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            open
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 transition-opacity duration-150 ease-in',
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}
