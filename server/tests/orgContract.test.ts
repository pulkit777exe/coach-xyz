import { describe, expect, test } from "bun:test"
import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
} from "../src/lib/orgEnums"
import {
  REPORT_TYPE_LABELS,
  MAX_IMPORT_ROWS,
  DEFAULT_COMPARISON_METRIC_KEY,
} from "../src/lib/orgValidate"

// Canonical org vocabulary — values AND order must match web-next/lib/org.ts
// (pinned there by web-next/lib/__tests__/orgContract.test.ts). Single-sided
// edits break this test on the unchanged side, surfacing drift in CI.
const CANONICAL = {
  studentStatuses: ["active", "inactive", "transferred"],
  attendanceStatuses: ["present", "late", "absent", "excused"],
  eventTypes: ["practice", "match", "tournament", "meeting", "other"],
  eventStatuses: ["scheduled", "completed", "cancelled"],
  reportTypes: ["progress", "attendance", "performance", "monthly"],
} as const

const CANONICAL_REPORT_TYPE_LABELS: Record<string, string> = {
  progress: "Progress Report",
  attendance: "Attendance Report",
  performance: "Performance Report",
  monthly: "Monthly Summary",
}

describe("server org enum contract (mirrors web-next/lib/org.ts)", () => {
  test("student statuses match canonical values and order", () => {
    expect([...STUDENT_STATUSES]).toEqual(CANONICAL.studentStatuses)
  })

  test("attendance statuses match canonical values and order", () => {
    expect([...ATTENDANCE_STATUSES]).toEqual(CANONICAL.attendanceStatuses)
  })

  test("event types match canonical values and order", () => {
    expect([...EVENT_TYPES]).toEqual(CANONICAL.eventTypes)
  })

  test("event statuses match canonical values and order", () => {
    expect([...EVENT_STATUSES]).toEqual(CANONICAL.eventStatuses)
  })

  test("report types match canonical values and order", () => {
    expect([...REPORT_TYPES]).toEqual(CANONICAL.reportTypes)
  })

  test("report type labels match the shared display vocabulary", () => {
    expect(REPORT_TYPE_LABELS).toEqual(CANONICAL_REPORT_TYPE_LABELS)
  })

  test.each([
    ["student statuses", STUDENT_STATUSES],
    ["attendance statuses", ATTENDANCE_STATUSES],
    ["event types", EVENT_TYPES],
    ["event statuses", EVENT_STATUSES],
    ["report types", REPORT_TYPES],
  ] as const)("%s contain no duplicates", (_label, members) => {
    expect(new Set(members).size).toBe(members.length)
  })
})

describe("bulk import + comparison route contract (shares orgValidate tokens)", () => {
  test("import cap is a positive number the route enforces", () => {
    expect(MAX_IMPORT_ROWS).toBe(500)
    expect(Number.isSafeInteger(MAX_IMPORT_ROWS)).toBe(true)
    expect(MAX_IMPORT_ROWS).toBeGreaterThan(0)
  })

  test("comparison default metric key is the canonical form_score key", () => {
    expect(DEFAULT_COMPARISON_METRIC_KEY).toBe("form_score")
  })

  test("comparison default key is a snake_case metric token", () => {
    expect(DEFAULT_COMPARISON_METRIC_KEY).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})