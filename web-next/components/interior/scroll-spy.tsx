'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface ScrollSpyItem {
  id: string
  label: string
}

interface ScrollSpyProps {
  sections: ScrollSpyItem[]
  root?: React.RefObject<HTMLElement | null>
  className?: string
}

export function ScrollSpy({ sections, root, className }: ScrollSpyProps) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '')
  const ids = sections.map((s) => s.id)

  useEffect(() => {
    const target = root?.current ?? window
    const onScroll = () => {
      let currentId = ids[0] ?? ''
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= 160) currentId = id
      }
      setActive(currentId)
    }
    onScroll()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [root, ids])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      className={cn(
        'sticky top-14 z-30 flex flex-wrap items-center gap-x-6 gap-y-1 bg-background py-2',
        className,
      )}
    >
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollTo(s.id)}
          className={cn(
            'cursor-pointer rounded-[4px] px-1.5 py-0.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            active === s.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}
