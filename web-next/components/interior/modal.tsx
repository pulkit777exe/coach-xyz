'use client'

import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { focusInitial, inertOutside, restoreFocusOnClose } from './overlay-a11y'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // `aria-modal` hides the page behind from the accessibility tree but leaves
    // it in the tab order, so the three below are what make the promise true:
    // focus starts inside, the rest of the document is inert, and dismissing
    // hands focus back to whatever opened the modal.
    focusInitial(panelRef.current)
    const undoInert = inertOutside(rootRef.current, document.body)
    const undoFocus = restoreFocusOnClose(document)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      undoInert()
      undoFocus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={rootRef} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Scrim only: dismissing is on Escape and the Close button, so a
          focusable backdrop would just be the first Tab stop inside the
          dialog — an invisible "Close" the user cannot see they are on. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 dark:bg-black/65 transition-opacity duration-200 ease-[var(--ease-out)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[8px] border border-border bg-popover shadow-lg',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="text-[16px] font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="cursor-pointer rounded-[4px] p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
