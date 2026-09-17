// ── Org validation & naming helpers (pure, unit-testable) ──────────────────
// Kept separate from the Elysia route file so they can be tested without
// booting the server or touching the database.

import { STUDENT_STATUSES } from "./orgEnums"
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

// ── Bulk import row validation ─────────────────────────────────────────────

const STUDENT_STATUS_SET: ReadonlySet<string> = new Set(STUDENT_STATUSES)

/** Bulk import contract: max rows accepted per request. */
export const MAX_IMPORT_ROWS = 500

/** Comparison contract: default metric key used when none is specified. */
export const DEFAULT_COMPARISON_METRIC_KEY = "form_score"

export type ImportRow = {
  full_name?: string
  email?: string
  phone?: string
  sport?: string
  position?: string
  jersey_number?: string | number
  date_of_birth?: string
  gender?: string
  guardian_name?: string
  guardian_phone?: string
  notes?: string
  status?: string
  joined_on?: string
}

/**
 * Validate a single CSV-import row against the same rules as the
 * single-student POST route.  Returns either the cleaned input object
 * or a string error reason.
 */
export function validateStudentRow(
  row: ImportRow,
): { ok: true; cleaned: Record<string, unknown> } | { ok: false; reason: string } {
  const name = typeof row.full_name === "string" ? row.full_name.trim() : ""
  if (!name) return { ok: false, reason: "full_name is required" }

  const cleaned: Record<string, unknown> = { full_name: name }

  if (row.email !== undefined && row.email !== "") {
    cleaned.email = row.email
  }
  if (row.phone !== undefined && row.phone !== "") {
    cleaned.phone = row.phone
  }
  if (row.sport !== undefined && row.sport !== "") {
    cleaned.sport = row.sport
  }
  if (row.position !== undefined && row.position !== "") {
    cleaned.position = row.position
  }
  if (row.gender !== undefined && row.gender !== "") {
    cleaned.gender = row.gender
  }
  if (row.guardian_name !== undefined && row.guardian_name !== "") {
    cleaned.guardian_name = row.guardian_name
  }
  if (row.guardian_phone !== undefined && row.guardian_phone !== "") {
    cleaned.guardian_phone = row.guardian_phone
  }
  if (row.notes !== undefined && row.notes !== "") {
    cleaned.notes = row.notes
  }

  // jersey_number — must be numeric if provided
  if (row.jersey_number !== undefined && row.jersey_number !== "") {
    const num = typeof row.jersey_number === "number"
      ? row.jersey_number
      : Number(row.jersey_number)
    if (!Number.isFinite(num)) {
      return { ok: false, reason: "jersey_number must be a number" }
    }
    cleaned.jersey_number = num
  }

  // status — must be in STUDENT_STATUSES if provided
  if (row.status !== undefined && row.status !== "") {
    if (!STUDENT_STATUS_SET.has(row.status as string)) {
      return {
        ok: false,
        reason: `status must be one of ${[...STUDENT_STATUS_SET].join(", ")}`,
      }
    }
    cleaned.status = row.status
  }

  // date_of_birth — YYYY-MM-DD if provided
  if (row.date_of_birth !== undefined && row.date_of_birth !== "") {
    if (!isDate(row.date_of_birth)) {
      return { ok: false, reason: "date_of_birth must be YYYY-MM-DD" }
    }
    cleaned.date_of_birth = row.date_of_birth
  }

  // joined_on — YYYY-MM-DD if provided
  if (row.joined_on !== undefined && row.joined_on !== "") {
    if (!isDate(row.joined_on)) {
      return { ok: false, reason: "joined_on must be YYYY-MM-DD" }
    }
    cleaned.joined_on = row.joined_on
  }

  return { ok: true, cleaned }
}

// ── Trend computation (pure, unit-testable) ───────────────────────────────

export type TrendInputPoint = {
  measured_at: string
  metric_key: string
  metric_value: number
  unit: string | null
  source: "analysis" | "manual"
}

export type TrendPoint = {
  measured_at: string
  metric_value: number
  unit: string | null
  source: "analysis" | "manual"
}

export type MetricTrend = {
  metric_key: string
  points: TrendPoint[]
  latest: number | null
  avg: number | null
  change: number | null
}

/** Round to 2 decimals, mirroring the report builder's avg formatting. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Group a performance series into per-metric trends with slope info.
 * `change` is the latest minus the earliest value for the metric.
 */
export function computeMetricTrends(series: TrendInputPoint[]): MetricTrend[] {
  const byKey = new Map<string, TrendPoint[]>()
  for (const p of series) {
    const existing = byKey.get(p.metric_key) ?? []
    existing.push({
      measured_at: p.measured_at,
      metric_value: p.metric_value,
      unit: p.unit,
      source: p.source,
    })
    byKey.set(p.metric_key, existing)
  }

  const trends: MetricTrend[] = []
  for (const [metric_key, points] of byKey) {
    points.sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    const values = points.map((p) => p.metric_value)
    const latest = values[values.length - 1] ?? null
    const avg =
      values.length > 0 ? round2(values.reduce((s, v) => s + v, 0) / values.length) : null
    const change = values.length >= 2 ? round2(values[values.length - 1] - values[0]) : null

    trends.push({ metric_key, points, latest, avg, change })
  }

  return trends
}