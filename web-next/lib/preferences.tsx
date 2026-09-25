'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'

import { getUserSettings, updateUserSettings } from './meApi'
import { adoptUserSettings, hasStoredUserSettings, toSyncedPatch } from './preferencesSync'

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

/**
 * Mirror device preferences to the signed-in account so they follow the user
 * across devices. Local state stays the source of truth for rendering — the
 * network never blocks a toggle.
 *
 * `enabled` is passed by the app shell, which is the only place that knows a
 * session exists: marketing visitors must not fire an authenticated request.
 */
export function usePreferenceSync(enabled: boolean): void {
  const { prefs, setTheme, setWeekStartsMonday, setReduceMotion } = usePreferences()
  const syncedRef = useRef(false)
  const echoRef = useRef(false)
  // Nothing may be pushed before the read has settled: a push from defaults
  // would land after the GET and overwrite the account's stored choice.
  const [syncReady, setSyncReady] = useState(false)

  // Hydrate once per session: the account wins when it has a stored row, so a
  // choice made on another device is adopted here. The provider owns this
  // state, so the result is applied even if this effect instance was torn down
  // by a StrictMode replay — guarding it with an `active` flag would discard
  // the only fetch while `syncedRef` blocks the retry.
  useEffect(() => {
    if (!enabled) return
    if (syncedRef.current) return
    syncedRef.current = true

    void getUserSettings()
      .then((settings) => {
        if (hasStoredUserSettings(settings)) {
          const next = adoptUserSettings(settings)
          // Mark the echo so the push effect does not write these values
          // straight back to the server.
          echoRef.current = true
          setTheme(next.theme)
          setWeekStartsMonday(next.weekStartsMonday)
          setReduceMotion(next.reduceMotion)
        }
        setSyncReady(true)
      })
      // Signed-out, offline, or a pre-migration account: local preferences
      // still work, so a failed sync is never user-visible — but pushes are
      // allowed from here on.
      .catch(() => setSyncReady(true))

    // Deliberately mount-only: later changes are pushed by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Push local changes up. Debounced so a change that touches several
  // preferences (a server adoption updates all three) is one write, not three,
  // and the hydration echo is skipped once for that single batch.
  useEffect(() => {
    if (!enabled || !syncReady) return
    const id = setTimeout(() => {
      if (echoRef.current) {
        echoRef.current = false
        return
      }
      void updateUserSettings(toSyncedPatch(prefs)).catch(() => {})
    }, 500)
    return () => clearTimeout(id)
  }, [enabled, syncReady, prefs])
}
