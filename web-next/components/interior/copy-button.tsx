'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  label: string
  children?: React.ReactNode
  className?: string
}

export function CopyButton({ value, label, children, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }, [value])

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 border border-border bg-transparent px-3 py-2 text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  )
}
