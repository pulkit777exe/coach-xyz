'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

/**
 * 28/32px ghost affordances (hover / press / focus ring), same family as
 * SettingsPanel's close button. Size is applied at each call site.
 */
const GHOST =
  'inline-flex shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'

/**
 * Below md the sidebar collapses into a sticky workspace bar with a hamburger;
 * the drawer shows the exact sidebar content (top rows + pinned account
 * footer) as an off-canvas panel — 200ms slide, ease-out, none under
 * reduced-motion. Always mounted but `inert` when closed, so opening is
 * instant with no skeleton; closes on backdrop click, Escape, or any link
 * click (focus returns to the toggle except after navigation).
 */
export default function MobileNavDrawer({
  label,
  footer,
  children,
}: {
  /** Workspace name shown in the bar + drawer header (e.g. "coach.xyz"). */
  label: string
  /** Account-menu block, pinned to the drawer bottom (mirrors the aside). */
  footer: React.ReactNode
  /** Sidebar scroll-region content (workspace row, switcher, search, nav). */
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <div className="md:hidden">
      {/* Mobile workspace bar — pins under the fixed topbar while scrolling. */}
      <div className="sticky top-14 z-30 flex h-11 items-center gap-1.5 border-b border-border bg-background px-2">
        <button
          ref={toggleRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={`${GHOST} size-8`}
        >
          <Menu className="size-4" />
        </button>
        <span className="min-w-0 truncate px-1 text-sm font-medium text-foreground">{label}</span>
      </div>

      {/* Dimmed backdrop */}
      <div
        aria-hidden="true"
        onClick={() => {
          setOpen(false)
          toggleRef.current?.focus()
        }}
        className={`fixed inset-0 z-[60] bg-black/45 transition-opacity duration-150 ease-out dark:bg-black/65 motion-reduce:transition-none ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Off-canvas panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} navigation`}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        onClick={(e) => {
          // Any link click navigates away — close without stealing focus back.
          if ((e.target as HTMLElement).closest('a')) setOpen(false)
        }}
        className={`fixed inset-y-0 left-0 z-[70] flex w-[280px] max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar outline-none transition-transform duration-200 ease-out motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
        }`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-2">
          <span className="min-w-0 truncate px-1 text-sm font-medium text-foreground">{label}</span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => {
              setOpen(false)
              toggleRef.current?.focus()
            }}
            className={`${GHOST} size-7`}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{children}</div>
        <div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">{footer}</div>
      </div>
    </div>
  )
}
