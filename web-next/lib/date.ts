const pad = (n: number) => String(n).padStart(2, "0")

/** Local `YYYY-MM-DD` for a Date (calendar day in the user's timezone). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local `HH:MM` for a Date. */
export function toISOTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}