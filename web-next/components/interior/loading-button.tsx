'use client'

import { useRef, useState } from 'react'
import { Slide } from 'loading-dev'
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
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 disabled:cursor-default disabled:opacity-60',
        className,
      )}
    >
      {state === 'pending' ? (
        <>
          <Slide size={12} />
          {pendingLabel}
        </>
      ) : state === 'success' ? (
        <span className="text-success">✓ {successLabel}</span>
      ) : (
        children
      )}
    </button>
  )
}
