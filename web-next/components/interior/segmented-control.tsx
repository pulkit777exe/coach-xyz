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

export function SegmentedControl({
  label,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1 rounded-[6px] bg-accent p-1', className)}
    >
      <span className="sr-only">{label}</span>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              'cursor-pointer rounded-[4px] px-3.5 py-1.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              active
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
