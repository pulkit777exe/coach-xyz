'use client'

import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { focusInitial, inertOutside, restoreFocusOnClose } from './overlay-a11y'

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

export function Drawer({
  open,
  onOpenChange,
  title,
  side = 'right',
  children,
  className,
}: DrawerProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // See modal.tsx — aria-modal alone leaves the page behind tabbable.
    focusInitial(panelRef.current)
    const undoInert = inertOutside(rootRef.current, document.body)
    const undoFocus = restoreFocusOnClose(document)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      undoInert()
      undoFocus()
    }
  }, [open, onOpenChange])

  const { panel, closed } = sideStyles[side]

  return (
    <div ref={rootRef} className={cn('fixed inset-0 z-[60]', !open && 'pointer-events-none')}>
      {/* Scrim only, for the same reason as modal.tsx. */}
      <div
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
        className={cn(
          'absolute inset-0 bg-black/45 dark:bg-black/65 transition-opacity duration-200 ease-[var(--ease-out)]',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* A closed drawer is translated off-screen but still in the DOM, so it is
          `inert` rather than merely invisible: an off-screen dialog that keeps
          its Close button in the tab order is the defect, not the animation. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        {...(open ? {} : { inert: true })}
        className={cn(
          'absolute bg-popover shadow-lg transition-transform duration-200 ease-in-out',
          panel,
          open ? 'translate-x-0 translate-y-0' : closed,
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="text-[16px] font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close drawer"
            className="cursor-pointer rounded-[4px] p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[calc(100%-3.5rem)] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
