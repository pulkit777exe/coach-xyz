// ── Month navigator ──────────────────────────────────────────────────────────
// One home for the month-grid loop repeated by the attendance + schedule
// calendars: current-month state, loading shape, fetch-then-render, and
// month navigation. Callers pass what a month load does (onFetch) and how
// failures surface (onError); the hook owns the in-flight race guard so a
// slow earlier month never clobbers a later one.

import { useCallback, useEffect, useRef, useState } from 'react'

/** First day of the calendar month containing `date` (local time). */
export const firstOfMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1)

/** Shift a first-of-month date by `delta` months. */
export const addCalendarMonths = (month: Date, delta: number): Date =>
  new Date(month.getFullYear(), month.getMonth() + delta, 1)

export const monthLabelFor = (month: Date): string =>
  month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export function useMonthNavigator(opts: {
  onFetch: (month: Date) => Promise<void>
  onError: (error: unknown) => void
}) {
  const [month, setMonth] = useState<Date>(() => firstOfMonth(new Date()))
  const [isLoading, setLoading] = useState(false)
  const onFetchRef = useRef(opts.onFetch)
  const onErrorRef = useRef(opts.onError)

  // Latest-callback refs (written in an effect — never during render).
  useEffect(() => {
    onFetchRef.current = opts.onFetch
    onErrorRef.current = opts.onError
  })

  const fetchSeq = useRef(0)

  const fetchMonth = useCallback(async (target: Date): Promise<void> => {
    const id = ++fetchSeq.current
    setLoading(true)
    try {
      await onFetchRef.current(target)
    } catch (error) {
      if (fetchSeq.current === id) onErrorRef.current(error)
    } finally {
      if (fetchSeq.current === id) setLoading(false)
    }
  }, [])

  const nav = useCallback(
    (delta: number) => {
      const next = addCalendarMonths(month, delta)
      setMonth(next)
      void fetchMonth(next)
    },
    [month, fetchMonth],
  )

  return {
    month,
    year: month.getFullYear(),
    monthNum: month.getMonth(),
    monthLabel: monthLabelFor(month),
    isLoading,
    setLoading,
    setMonth,
    fetchMonth,
    nav,
  }
}
