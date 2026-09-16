'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface LoadingButtonProps {
  onAction: () => void | Promise<unknown>
  pendingLabel: string
  successLabel: string
  children: React.ReactNode
  className?: string
}

type State = 'idle' | 'pending' | 'success'

export function LoadingButton({
  onAction,
  pendingLabel,
  successLabel,
  children,
  className,
}: LoadingButtonProps) {
  const [state, setState] = useState<State>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = async () => {
    if (state !== 'idle') return
    setState('pending')
    try {
      await onAction()
    } catch {
      setState('idle')
      return
    }
    setState('success')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2500)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'pending'}
      className={cn('inline-flex cursor-pointer items-center gap-2 disabled:cursor-default disabled:opacity-60', className)}
    >
      {state === 'pending' ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-primary" />
          {pendingLabel}
        </>
      ) : state === 'success' ? (
        <span className="text-green-400">✓ {successLabel}</span>
      ) : (
        children
      )}
    </button>
  )
}