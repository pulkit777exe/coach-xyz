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
  const ref = useRef<HTMLSpanElement>(null)

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
      onMouseEnter={trigger === 'hover' ? () => setOpen(true) : undefined}
      onMouseLeave={trigger === 'hover' ? () => setOpen(false) : undefined}
      onClick={trigger === 'click' ? () => setOpen((v) => !v) : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute left-1/2 z-50 w-56 -translate-x-1/2 border border-(--cream-10) bg-(--bg) p-3 text-xs leading-relaxed text-(--cream-40) shadow-lg',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}