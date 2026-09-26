'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  Bell,
  Building2,
  Gauge,
  LockKeyhole,
  Shield,
  SlidersHorizontal,
  User,
  Users,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Section icons are plain string keys, not component references — server
 * pages must not pass lucide components across the RSC boundary into this
 * client shell. The keys resolve to icons imported here.
 */
export type SettingsSectionIcon =
  | 'account'
  | 'security'
  | 'preferences'
  | 'notifications'
  | 'organization'
  | 'privacy'
  | 'members'
  | 'plan'
  | 'records'

const SECTION_ICONS: Record<SettingsSectionIcon, React.ElementType> = {
  account: User,
  security: Shield,
  preferences: SlidersHorizontal,
  notifications: Bell,
  organization: Building2,
  privacy: LockKeyhole,
  members: Users,
  plan: Gauge,
  records: BarChart3,
}

/** One left-nav entry plus the right-pane content it anchors to. */
export type SettingsSection = {
  /** Anchor id — the `#fragment` target for the nav link. */
  id: string
  label: string
  icon: SettingsSectionIcon
  content: React.ReactNode
}

/**
 * 28px ghost affordances (hover / press / focus ring) — the sidebar
 * SIDEBAR_ICON_BUTTON row previously duplicated in both layouts, reused here
 * for the panel's close button and echoed by the profile menu trigger.
 */
const CLOSE_BUTTON_CLASS =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'

const NAV_ITEM_CLASS =
  'flex h-7 shrink-0 items-center gap-2 rounded-[4px] px-2 text-sm outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
const NAV_ITEM_ACTIVE_CLASS = 'bg-accent font-medium text-foreground'
const NAV_ITEM_IDLE_CLASS = 'text-foreground/90 hover:bg-accent'

/**
 * Notion-style settings pop-out: a dimmed backdrop with a centered two-pane
 * panel floating over the route (deep links keep working — this is page
 * content, not a Dialog). Left pane is the section nav (a horizontal chip
 * row below md), right pane is the scrollable content. The nav highlights
 * via scroll-spy, which is why this shell is a client component — the pages
 * using it stay server components and keep their data fetches.
 */
export default function SettingsPanel({
  title,
  description,
  sections,
  closeHref,
  notice,
}: {
  title: string
  description?: string
  sections: SettingsSection[]
  /** Where the X button and backdrop click return to. */
  closeHref: string
  /** Optional banner rendered above the sections (e.g. a load error). */
  notice?: React.ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  // Scroll-spy: keep the left nav highlight in sync with the right pane.
  // Deferred through rAF so the first paint never does synchronous setState.
  useEffect(() => {
    const pane = contentRef.current
    if (!pane || sections.length === 0) return
    const ids = sections.map((section) => section.id)
    let frame = 0

    const syncActive = () => {
      const paneTop = pane.getBoundingClientRect().top
      const scrolledToBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
      let next = ids[0]
      if (scrolledToBottom) {
        next = ids[ids.length - 1]
      } else {
        for (const id of ids) {
          const el = document.getElementById(id)
          if (el && el.getBoundingClientRect().top - paneTop <= 48) next = id
        }
      }
      if (next) setActiveId(next)
    }
    const scheduleSync = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        syncActive()
      })
    }

    // Initial sync also covers deep links (#records) scrolled before hydration.
    scheduleSync()
    pane.addEventListener('scroll', scheduleSync, { passive: true })
    return () => {
      pane.removeEventListener('scroll', scheduleSync)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [sections])

  return (
    <>
      {/* Dimmed backdrop — click anywhere outside the panel to close. */}
      <Link
        href={closeHref}
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 z-50 bg-black/45 dark:bg-black/65"
      />
      {/* Panel wrapper: full-bleed on mobile, centered with margins from md up. */}
      <div className="pointer-events-none fixed inset-0 z-50 flex justify-center p-0 md:items-center md:p-6">
        <div className="pointer-events-auto flex min-h-full w-full max-w-[960px] flex-col overflow-hidden border border-border bg-background shadow-[0_16px_70px_-12px_rgba(0,0,0,.35)] md:flex-row md:max-h-[calc(100vh-3rem)] md:min-h-[70vh] md:rounded-[8px]">
          {/* Left nav — gray sidebar tone; chip row on mobile, column from md. */}
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar px-2 py-2 md:w-[240px] md:flex-col md:gap-0.5 md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:px-2 md:py-3"
          >
            {sections.map((section) => {
              const isActive = section.id === activeId
              const Icon = SECTION_ICONS[section.icon]
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setActiveId(section.id)}
                  className={cn(
                    NAV_ITEM_CLASS,
                    isActive ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_IDLE_CLASS,
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap">{section.label}</span>
                </a>
              )
            })}
          </nav>

          {/* Right side — header with close affordance over scrollable content. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-lead font-semibold leading-[1.4] tracking-[-0.01em] text-foreground">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-0.5 truncate text-meta leading-[1.5] text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              <Link href={closeHref} aria-label="Close settings" className={CLOSE_BUTTON_CLASS}>
                <X className="size-4" aria-hidden="true" />
              </Link>
            </header>

            <div
              ref={contentRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8"
            >
              {notice ? <div className="mb-8">{notice}</div> : null}
              <div className="space-y-8">
                {sections.map((section) => (
                  <section key={section.id} id={section.id}>
                    {section.content}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
