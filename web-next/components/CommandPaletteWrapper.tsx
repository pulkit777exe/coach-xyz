'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CommandPalette, type CommandItem } from '@/components/interior/command-palette'

export function CommandPaletteWrapper() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const commands: CommandItem[] = [
    { id: 'home', label: 'Go to Home', hint: 'Upload a new video' },
    { id: 'dashboard', label: 'Go to Dashboard', hint: 'View your overview' },
    { id: 'history', label: 'Go to History', hint: 'Browse all analyses' },
    { id: 'account', label: 'Go to Account', hint: 'Manage your profile' },
    { id: 'theme-toggle', label: 'Toggle Theme', hint: 'Switch between light and dark mode' },
  ]

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleSelect = useCallback((item: CommandItem) => {
    setOpen(false)
    if (item.id === 'home') router.push('/')
    else if (item.id === 'dashboard') router.push('/dashboard')
    else if (item.id === 'history') router.push('/dashboard/history')
    else if (item.id === 'account') router.push('/account')
    else if (item.id === 'theme-toggle') {
      const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
      const next = current === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('dark', next === 'dark')
      document.documentElement.classList.toggle('light', next === 'light')
      localStorage.setItem('coach-theme', next)
    }
  }, [router])

  return (
    <CommandPalette
      open={open}
      items={commands}
      onSelect={handleSelect}
      onDismiss={() => setOpen(false)}
      className="[&_*]:!text-(--fg)"
    />
  )
}
