import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, disabled, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'placeholder:text-muted-foreground hover:border-ring/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-[var(--input-fill)] border-[var(--input)] flex field-sizing-content min-h-9 w-full rounded-md border px-3 py-2 text-base transition-[color,box-shadow,border-color] duration-150 ease-[var(--ease-out)] outline-none data-disabled:pointer-events-none data-disabled:opacity-50 md:text-sm',
        className,
      )}
      data-disabled={disabled}
      disabled={disabled}
      {...props}
    />
  )
}

export { Textarea }
