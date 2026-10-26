import type { ReactNode } from 'react'

const TONES = {
  gray: 'bg-muted text-muted-foreground',
  blue: 'bg-info/15 text-info',
  green: 'bg-success/15 text-success',
  amber: 'bg-warning/15 text-warning',
  red: 'bg-destructive/10 text-destructive',
  primary: 'bg-primary/15 text-primary',
} as const

export type StatusTone = keyof typeof TONES

/**
 * Full-radius status pill: 11px/500, soft tinted background.
 * Tone maps to the product's semantic status colors (To-do / In progress / …).
 */
export default function StatusPill({
  children,
  tone = 'gray',
  className = '',
}: {
  children: ReactNode
  tone?: StatusTone
  className?: string
}) {
  return (
    <span
      className={`inline-flex h-[20px] items-center rounded-full px-2 font-medium leading-none text-label ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
