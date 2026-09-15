'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ThemeToggle({ variant = 'default' }: { variant?: 'default' | 'landing' }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <span className="size-8" />
  }

  const isDark = resolvedTheme === 'dark'

  if (variant === 'landing') {
    return (
      <button
        aria-label="Toggle theme"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="inline-flex size-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
      >
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    )
  }

  return (
    <button
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground text-muted-foreground"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
