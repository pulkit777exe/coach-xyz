'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'

// ── User preferences (Notion-style Preferences page) ────────────────────────
// Local-only (localStorage): appearance and calendar conventions that need
// no backend. Every preference has a visible effect — no decorative toggles.

export type ThemeChoice = 'system' | 'light' | 'dark'

export type Preferences = {
  theme: ThemeChoice
  weekStartsMonday: boolean
  reduceMotion: boolean
}

const DEFAULTS: Preferences = {
  theme: 'system',
  weekStartsMonday: false,
  reduceMotion: false,
}

const STORAGE_KEY = 'coachxyz:preferences'

function loadStored(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
      weekStartsMonday: parsed.weekStartsMonday === true,
      reduceMotion: parsed.reduceMotion === true,
    }
  } catch {
    return DEFAULTS
  }
}

type PreferencesContextValue = {
  prefs: Preferences
  setTheme: (theme: ThemeChoice) => void
  setWeekStartsMonday: (on: boolean) => void
  setReduceMotion: (on: boolean) => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { setTheme: applyTheme } = useTheme()
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)

  // Boot: load stored prefs once, push theme + motion class into effect.
  // Deferred via rAF so the initial setState stays out of the effect body.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const stored = loadStored()
      setPrefs(stored)
      setHydrated(true)
      applyTheme(stored.theme)
      document.documentElement.classList.toggle('reduce-motion', stored.reduceMotion)
    })
    return () => cancelAnimationFrame(id)
  }, [applyTheme])

  // Persist on change (localStorage write only — no setState, lint-clean).
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // private mode — prefs last for the session
    }
  }, [prefs, hydrated])

  const setTheme = useCallback(
    (theme: ThemeChoice) => {
      applyTheme(theme)
      setPrefs((prev) => ({ ...prev, theme }))
    },
    [applyTheme],
  )

  const setWeekStartsMonday = useCallback((on: boolean) => {
    setPrefs((prev) => ({ ...prev, weekStartsMonday: on }))
  }, [])

  const setReduceMotion = useCallback((on: boolean) => {
    document.documentElement.classList.toggle('reduce-motion', on)
    setPrefs((prev) => ({ ...prev, reduceMotion: on }))
  }, [])

  const value = useMemo(
    () => ({ prefs, setTheme, setWeekStartsMonday, setReduceMotion }),
    [prefs, setTheme, setWeekStartsMonday, setReduceMotion],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider')
  return ctx
}
