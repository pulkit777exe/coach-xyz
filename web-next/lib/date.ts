const pad = (n: number) => String(n).padStart(2, "0")

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
  return localDay(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** "September 13, 2026" — accepts `YYYY-MM-DD` or a full ISO datetime. */
export function formatDateLong(iso: string): string {
  return localDay(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

/** "Sep 13" — accepts `YYYY-MM-DD` or a full ISO datetime. */
export function formatDateShort(iso: string): string {
  const d = iso.length === 10 ? localDay(iso) : new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}