// ── CSV helpers ─────────────────────────────────────────────────────────────
// One home for spreadsheet-safe serialization: every CSV export defuses
// formula injection and quotes delimiters the same way (findings CSV proved
// the shape; org exports reuse it).

const CSV_FORMULA_RE = /^[=+\-@\t\r]/

/** Escape one CSV cell: defuse formula injection, quote delimiters. */
export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  const safe = CSV_FORMULA_RE.test(raw) ? `'${raw}` : raw
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serialize rows under a stable header (pure; BOM-free — routes add it). */
export const rowsToCsv = (columns: readonly string[], rows: unknown[][]): string =>
  [columns.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
