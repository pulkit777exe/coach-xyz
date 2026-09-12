'use client'

import { cn } from '@/lib/utils'

interface SegmentedOption {
  value: string
  label: string
}

interface SegmentedControlProps {
  label: string
  options: SegmentedOption[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}

export function SegmentedControl({ label, options, value, onValueChange, className }: SegmentedControlProps) {
  return (
    <div className={cn('inline-flex items-center gap-1 border border-(--cream-10) p-1', className)}>
      <span className="sr-only">{label}</span>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              'cursor-pointer px-4 py-2 text-[0.65rem] uppercase tracking-[0.15em] transition-colors',
              active
                ? 'bg-(--fg) text-(--bg)'
                : 'text-(--cream-40) hover:text-(--fg)',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}