'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--card-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '8px',
          '--error-bg': 'var(--card)',
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--border)',
          '--warning-bg': 'var(--card)',
          '--warning-text': 'var(--warning)',
          '--warning-border': 'var(--border)',
          '--info-bg': 'var(--card)',
          '--info-text': 'var(--info)',
          '--info-border': 'var(--border)',
          '--success-bg': 'var(--card)',
          '--success-text': 'var(--success)',
          '--success-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
