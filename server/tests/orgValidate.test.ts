import { describe, expect, test } from "bun:test"
import {
  isDate,
  isIsoDate,
  defaultReportTitle,
  REPORT_TYPE_LABELS,
} from "../src/lib/orgValidate"

describe("isDate", () => {
  test("accepts YYYY-MM-DD", () => {
    expect(isDate("2026-09-12")).toBe(true)
    expect(isDate("2000-01-01")).toBe(true)
  })

  test("rejects malformed formats", () => {
    expect(isDate("2026-9-12")).toBe(false)
    expect(isDate("2026/09/12")).toBe(false)
    expect(isDate("today")).toBe(false)
    expect(isDate("20260912")).toBe(false)
    expect(isDate("")).toBe(false)
  })

  test("rejects non-strings", () => {
    expect(isDate(null)).toBe(false)
    expect(isDate(undefined)).toBe(false)
    expect(isDate(20260912)).toBe(false)
    expect(isDate(new Date("2026-09-12"))).toBe(false)
  })

  test("is format-only: calendar validity is left to the DB", () => {
    expect(isDate("2026-13-01")).toBe(true)
    expect(isDate("2026-02-31")).toBe(true)
  })
})

describe("isIsoDate", () => {
  test("accepts parseable date strings", () => {
    expect(isIsoDate("2026-09-12")).toBe(true)
    expect(isIsoDate("2026-09-12T18:30:00Z")).toBe(true)
    expect(isIsoDate("2026-09-12T18:30:00.000+05:30")).toBe(true)
  })

  test("rejects unparseable values", () => {
    expect(isIsoDate("not-a-date")).toBe(false)
    expect(isIsoDate("")).toBe(false)
    expect(isIsoDate(null)).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
    expect(isIsoDate(12345)).toBe(false)
  })
})

describe("defaultReportTitle", () => {
  test("prepends the student name for known types", () => {
    expect(defaultReportTitle("progress", { full_name: "Alex Rivera" })).toBe(
      "Alex Rivera — Progress Report",
    )
    expect(defaultReportTitle("monthly", { full_name: "Alex Rivera" })).toBe(
      "Alex Rivera — Monthly Summary",
    )
  })

  test("falls back to Organization when no student", () => {
    expect(defaultReportTitle("progress", null)).toBe("Organization — Progress Report")
    expect(defaultReportTitle("attendance", null)).toBe("Organization — Attendance Report")
  })

  test("falls back to Report for unknown scope types", () => {
    expect(defaultReportTitle("unknown-type", { full_name: "Alex Rivera" })).toBe(
      "Alex Rivera — Report",
    )
  })
})

describe("REPORT_TYPE_LABELS", () => {
  test("covers every supported report type", () => {
    expect(REPORT_TYPE_LABELS).toMatchObject({
      progress: expect.any(String),
      attendance: expect.any(String),
      performance: expect.any(String),
      monthly: expect.any(String),
    })
  })
})