'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'

type DrawerSide = 'left' | 'right' | 'top' | 'bottom'

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  side?: DrawerSide
  children: React.ReactNode
  className?: string
}

const sideStyles: Record<DrawerSide, { panel: string; closed: string }> = {
  right: { panel: 'right-0 top-0 h-full w-full max-w-sm', closed: 'translate-x-full' },
  left: { panel: 'left-0 top-0 h-full w-full max-w-sm', closed: '-translate-x-full' },
  top: { panel: 'left-0 top-0 w-full max-h-[60vh]', closed: '-translate-y-full' },
  bottom: { panel: 'bottom-0 left-0 w-full max-h-[60vh]', closed: 'translate-y-full' },
}

export function Drawer({ open, onOpenChange, title, side = 'right', children, className }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onOpenChange])

  const { panel, closed } = sideStyles[side]

  return (
    <div className={cn('fixed inset-0 z-[60]', !open && 'pointer-events-none')}>
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className={cn(
          'absolute inset-0 bg-black/60 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute bg-background shadow-2xl transition-transform duration-300',
          panel,
          open ? 'translate-x-0 translate-y-0' : closed,
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close drawer"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(100%-3.5rem)] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}