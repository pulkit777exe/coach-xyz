// ── Org vocabulary (single source of truth) ─────────────────────────────────
// Types are derived from the arrays below; the schema CHECK constraints
// (supabaseHistory.ts), route validation (org.ts) and report titles
// (orgValidate.ts) all import from here so a new value is added in one place.

export const STUDENT_STATUSES = ["active", "inactive", "transferred"] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const EVENT_TYPES = ["practice", "match", "tournament", "meeting", "other"] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = ["scheduled", "completed", "cancelled"] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const REPORT_TYPES = ["progress", "attendance", "performance", "monthly"] as const
export type ReportType = (typeof REPORT_TYPES)[number]