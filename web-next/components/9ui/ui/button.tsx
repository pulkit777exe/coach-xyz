'use client'

import * as React from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 data-disabled:pointer-events-none data-disabled:opacity-50 active:scale-[0.98] [transition:background-color_150ms_var(--ease-out),color_150ms,border-color_150ms,transform_120ms,scale_120ms] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]',
        secondary:
          'bg-popover text-foreground border border-[var(--border)] hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        outline:
          'bg-card text-primary border border-[var(--border)] hover:bg-accent',
        link: 'text-foreground hover:underline',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-8 px-3 gap-1',
        default: 'h-9 px-4',
        lg: 'h-10 px-5',
        'icon-sm': "size-8 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-9',
        'icon-lg': "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = VariantProps<typeof buttonVariants> & React.ComponentProps<typeof BaseButton>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <BaseButton
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
