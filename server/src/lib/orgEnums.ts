// ── Org vocabulary (single source of truth, server side) ─────────────────────
// Types are derived from the arrays below; the schema CHECK constraints
// (historyStore.ts), route validation (org.ts) and report titles
// (orgValidate.ts) all import from here so a new value is added in one place.
// NOTE: values AND order must match web-next/lib/org.ts — pinned by the
// org *Contract tests on both sides.

export const STUDENT_STATUSES = ['active', 'inactive', 'transferred', 'archived'] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const EVENT_TYPES = ['practice', 'match', 'tournament', 'meeting', 'other'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const REPORT_TYPES = ['progress', 'attendance', 'performance', 'monthly'] as const
export type ReportType = (typeof REPORT_TYPES)[number]
