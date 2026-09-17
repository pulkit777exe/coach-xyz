import { afterEach, describe, expect, test, vi } from "vitest"
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  REPORT_TYPES,
  REPORT_TYPE_LABELS,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
  orgCompareStudents,
  orgStudentTrends,
} from "@/lib/org"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Canonical org vocabulary — values AND order must match server/src/lib/orgEnums.ts
// (pinned there by server/tests/orgContract.test.ts). Single-sided edits break
// this test on the unchanged side, surfacing drift in CI.
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

function assertLabelMap<M extends readonly string[]>(
  members: M,
  labels: Record<M[number], string>,
) {
  test("every enum member has a non-empty label and keys match members exactly", () => {
    for (const member of members) {
      expect(labels[member as M[number]].length).toBeGreaterThan(0)
    }
    expect(Object.keys(labels).sort()).toEqual([...members].sort())
  })

  test("enum contains no duplicate members", () => {
    expect(new Set(members).size).toBe(members.length)
  })
}

describe("web org label maps", () => {
  assertLabelMap(STUDENT_STATUSES, STUDENT_STATUS_LABELS)
  assertLabelMap(ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS)
  assertLabelMap(EVENT_TYPES, EVENT_TYPE_LABELS)
  assertLabelMap(EVENT_STATUSES, EVENT_STATUS_LABELS)
  assertLabelMap(REPORT_TYPES, REPORT_TYPE_LABELS)
})

describe("web org enum contract (mirrors server/src/lib/orgEnums.ts)", () => {
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
})

describe("web trend/comparison contract (mirrors server route tokens)", () => {
  test("comparison and trends are plain-fetch fns on the org module", () => {
    expect(typeof orgCompareStudents).toBe("function")
    expect(typeof orgStudentTrends).toBe("function")
  })

  test("comparison ids are comma-joined under the students/comparison token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ comparison: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgCompareStudents("auth|1", ["s1", "s2"])

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C1/students/comparison?ids=s1,s2",
    )
  })

  test("trends endpoint lives under the student detail namespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ trends: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgStudentTrends("auth|1", "stu-1")

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C1/students/stu-1/trends",
    )
  })
})