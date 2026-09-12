// ── Org validation & naming helpers (pure, unit-testable) ──────────────────
// Kept separate from the Elysia route file so they can be tested without
// booting the server or touching the database.

import type { ReportType } from "./orgEnums"

/** Matches a YYYY-MM-DD calendar string (format-level only; real calendar
 *  validity is enforced by the DB date cast). */
export const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Any string Date.parse can understand (ISO timestamp, etc.). */
export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  progress: "Progress Report",
  attendance: "Attendance Report",
  performance: "Performance Report",
  monthly: "Monthly Summary",
}

export function defaultReportTitle(
  reportType: string,
  student: { full_name: string } | null,
): string {
  const label = student ? student.full_name : "Organization"
  return `${label} — ${(REPORT_TYPE_LABELS as Record<string, string>)[reportType] ?? "Report"}`
}