'use client'

import { useEffect, useId, useRef, useState } from 'react'
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
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const contentId = useId()

  const show = () => {
    setEverOpen(true)
    setOpen(true)
  }

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) {
      triggerRef.current?.focus()
    }
  }

  useEffect(() => {
    if (trigger !== 'click' || !open) return
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [trigger, open])

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (trigger === 'click' && (e.key === 'Enter' || e.key === ' ')) {
      // Avoid toggling twice when the wrapped child is already an interactive button.
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      setOpen((v) => {
        const next = !v
        if (next) setEverOpen(true)
        return next
      })
    }
  }

  const content = everOpen ? (
    <span
      ref={contentRef}
      id={contentId}
      role={trigger === 'click' ? 'dialog' : 'tooltip'}
      aria-hidden={!open}
      tabIndex={-1}
      className={cn(
        'absolute left-1/2 z-50 w-56 -translate-x-1/2 rounded-[6px] border border-border bg-popover p-3 text-[13px] leading-relaxed text-muted-foreground shadow-lg',
        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        open ? 'opacity-100' : 'pointer-events-none opacity-0 transition-opacity duration-150 ease-in',
      )}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close(true)
        }
      }}
    >
      {label}
    </span>
  ) : null

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      <span
        ref={triggerRef}
        role={trigger === 'click' ? 'button' : undefined}
        tabIndex={trigger === 'click' ? 0 : undefined}
        aria-haspopup={trigger === 'click' ? 'dialog' : undefined}
        aria-expanded={trigger === 'click' ? open : undefined}
        aria-controls={trigger === 'click' && everOpen ? contentId : undefined}
        aria-describedby={trigger === 'hover' && everOpen ? contentId : undefined}
        className="inline-flex"
        onMouseEnter={trigger === 'hover' ? show : undefined}
        onMouseLeave={trigger === 'hover' ? () => close() : undefined}
        onFocus={trigger === 'hover' ? show : undefined}
        onBlur={(e) => {
          if (trigger !== 'hover') return
          const next = e.relatedTarget as Node | null
          if (next && rootRef.current?.contains(next)) return
          close()
        }}
        onClick={
          trigger === 'click'
            ? () => {
                setOpen((v) => {
                  const next = !v
                  if (next) setEverOpen(true)
                  return next
                })
              }
            : undefined
        }
        onKeyDown={onTriggerKeyDown}
      >
        {children}
      </span>
      {content}
    </span>
  )
}
