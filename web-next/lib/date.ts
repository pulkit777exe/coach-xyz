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

/**
 * "October 6, 2026, 11:45 PM" — the calendar day from the string, the clock time from
 * the instant.
 *
 * Those are two different sources on purpose, which is what makes this function easy to get
 * wrong. The date is read out of the string's first 10 characters, exactly as
 * `formatDateMed` does, so a 23:45Z instant does not slide into the next day east of UTC.
 * The TIME is read from the instant, because "when did this happen" is a question about the
 * viewer's clock and there is no string-only answer to it.
 *
 * **The first version of this function called `localDay(iso)` and returned 12:00 AM for
 * every analysis** — `localDay` parses `YYYY-MM-DD` as local MIDNIGHT, so the time
 * component was silently discarded, and the site it replaced (which showed the real local
 * time via `new Date(iso)`) lost its information entirely. That is worse than the off-by-one
 * it was written to fix, and it survived until a test asserted the time varies by timezone,
 * which it could not do if it were always midnight. The two sources are combined explicitly
 * below rather than by formatting one Date.
 */
export function formatDateTime(iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return localDay(iso).toLocaleString('en-US', DATE_TIME)
  // Start from local midnight of the STRING's day, then graft the instant's local clock
  // time onto it. Setting hours on a local Date does not re-interpret the zone, so this
  // cannot reintroduce the day shift the date half exists to avoid.
  const merged = localDay(iso)
  merged.setHours(instant.getHours(), instant.getMinutes(), 0, 0)
  return merged.toLocaleString('en-US', DATE_TIME)
}

const DATE_TIME = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
} as const

/** "Tue, Oct 6" — a weekday-qualified day, no year. */
export function formatDayWeekday(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** "Tue, Oct 6, 2026" — the same, with the year. */
export function formatDayWeekdayYear(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * "10/6/2026" — the numeric form, pinned to `en-US`.
 *
 * Two sites called bare `toLocaleDateString()` with no locale at all, so the SAME instant
 * rendered as `10/6/2026` in one browser and `06/10/2026` in another — and, on a day-first
 * locale, the day and month swap places entirely. Pinning the locale is the same class of
 * fix as reading the day out of the string: a value that varies by machine is not a value
 * the design system owns.
 */
export function formatDateNumeric(iso: string): string {
  return localDay(iso).toLocaleDateString('en-US')
}

/**
 * "Oct 6, 2026, 11:45 PM" — the `dateStyle`/`timeStyle` shape, day from the string.
 *
 * One site (`ReportBody.tsx`) used `{ dateStyle: 'medium', timeStyle: 'short' }`, which is
 * a fourth timecode format in this app alongside the three the audit found. Same split as
 * `formatDateTime`: calendar day from the string, clock time from the instant.
 */
export function formatDateTimeShort(iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) {
    return localDay(iso).toLocaleString('en-US', DATE_TIME_SHORT)
  }
  const merged = localDay(iso)
  merged.setHours(instant.getHours(), instant.getMinutes(), 0, 0)
  return merged.toLocaleString('en-US', DATE_TIME_SHORT)
}

const DATE_TIME_SHORT = { dateStyle: 'medium', timeStyle: 'short' } as const
