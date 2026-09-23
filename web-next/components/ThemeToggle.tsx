'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (!mounted) {
    return <span className="size-8" aria-hidden />
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
    >
      {/* Crossfade + slight rotate between sun/moon — ≤200ms ease-out. */}
      <span className="relative size-4">
        <Sun
          aria-hidden
          className={cn(
            'absolute inset-0 size-4 transition-[opacity,transform] duration-200 ease-out',
            isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0',
          )}
        />
        <Moon
          aria-hidden
          className={cn(
            'absolute inset-0 size-4 transition-[opacity,transform] duration-200 ease-out',
            isDark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100',
          )}
        />
      </span>
    </button>
  )
}
