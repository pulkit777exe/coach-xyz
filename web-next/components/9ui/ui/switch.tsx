'use client'

import * as React from 'react'
import { Switch as BaseSwitch } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

function Switch({ className, ...props }: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      data-slot="switch"
      className={cn(
        'bg-[var(--switch-off)] focus-visible:ring-ring/40 data-checked:bg-primary data-checked:border-primary relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-out)] outline-none focus-visible:ring-2 focus-visible:ring-offset-0 data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-[var(--switch-thumb)] block size-3.5 translate-x-0.5 rounded-full transition-transform duration-150 data-checked:translate-x-4',
        )}
      />
    </BaseSwitch.Root>
  )
}

export { Switch }
