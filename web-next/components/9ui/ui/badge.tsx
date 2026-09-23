import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none overflow-hidden',
  {
    variants: {
      variant: {
        default: 'bg-primary border-transparent text-primary-foreground',
        outline: 'border-[var(--border)] text-foreground',
        secondary: 'bg-secondary border-transparent text-secondary-foreground',
        success: 'bg-success/12 border-transparent text-success',
        warning: 'bg-warning/12 border-transparent text-warning',
        info: 'bg-info/12 border-transparent text-info',
        danger: 'bg-danger/12 border-transparent text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
