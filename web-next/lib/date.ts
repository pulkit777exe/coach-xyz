const pad = (n: number) => String(n).padStart(2, '0')

/** Local `YYYY-MM-DD` for a Date (calendar day in the user's timezone). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local `HH:MM` for a Date. */
export function toISOTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parses `YYYY-MM-DD` as a local calendar day (avoids UTC date-shifting). */
function localDay(iso: string): Date {
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso
  return new Date(`${datePart}T00:00:00`)
}

/** "Sep 13, 2026" — accepts `YYYY-MM-DD` or a full ISO datetime. */
export function formatDateMed(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "September 13, 2026" — accepts `YYYY-MM-DD` or a full ISO datetime. */
export function formatDateLong(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * "Sep 13" — accepts `YYYY-MM-DD` or a full ISO datetime.
 *
 * Reads the calendar day out of the string like formatDateMed/formatDateLong do,
 * rather than localizing the instant. It used to `new Date(iso)` a full
 * datetime, so a 23:30Z analysis and a 23:45Z one displayed as "Sep 13" and
 * "Sep 14" in UTC+1 while the formatDateMed rows beside them in the same column
 * both said "Sep 13" — the two helpers disagreed about which day an instant
 * belongs to. Truncating to the date part is what the other two already do, and
 * it makes the whole module consistent.
 */
export function formatDateShort(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Local-calendar window for a month's schedule, widened by `bufferDays` on
 * each side so month-boundary events survive timezone skew between the server
 * and the browser. `from` is midnight of the day before the 1st, `to` is
 * 23:59:59 of the day after the last day.
 */
export function scheduleMonthWindow(date: Date, bufferDays = 1): { from: Date; to: Date } {
  const from = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0)
  from.setDate(from.getDate() - bufferDays)
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59)
  to.setDate(to.getDate() + bufferDays)
  return { from, to }
}
