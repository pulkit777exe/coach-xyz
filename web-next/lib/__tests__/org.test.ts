import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
  linkAnalysisToStudent,
  orgCreateStudent,
  orgEmailAttendance,
  orgEmailReport,
  orgSendInvites,
  orgStudents,
  orgImportStudents,
  orgStudentTrends,
  orgCompareStudents,
} from "../org"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("org enum constants", () => {
  it("have no duplicate values", () => {
    const noDupes = (values: readonly string[]) =>
      expect(new Set(values).size).toBe(values.length)
    noDupes(STUDENT_STATUSES)
    noDupes(ATTENDANCE_STATUSES)
    noDupes(EVENT_TYPES)
    noDupes(EVENT_STATUSES)
    noDupes(REPORT_TYPES)
  })

  it("define the expected vocabulary", () => {
    expect(STUDENT_STATUSES).toEqual(["active", "inactive", "transferred"])
    expect(ATTENDANCE_STATUSES).toEqual(["present", "late", "absent", "excused"])
    expect(EVENT_TYPES).toEqual(["practice", "match", "tournament", "meeting", "other"])
    expect(EVENT_STATUSES).toEqual(["scheduled", "completed", "cancelled"])
    expect(REPORT_TYPES).toEqual(["progress", "attendance", "performance", "monthly"])
  })
})

describe("orgStudents", () => {
  it("builds the students URL and forwards search/sport/status filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ students: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgStudents("auth|123", { search: "Al", sport: "tennis", status: "active" })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C123/students?search=Al&sport=tennis&status=active",
    )
  })

  it("omits empty filters from the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ students: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgStudents("auth|123")

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/org/auth%7C123/students")
  })
})

describe("linkAnalysisToStudent", () => {
  it("PUTs the student id to the job's student endpoint", async () => {
    const analysis = { server_job_id: "job-1", student_id: "stu-9" }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ analysis }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await linkAnalysisToStudent("auth|123", "job-1", "stu-9")

    expect(result.analysis).toEqual(analysis)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/org/auth%7C123/analyses/job-1/student")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({ student_id: "stu-9" })
  })

  it("sends null to unlink a student", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ analysis: {} }))
    vi.stubGlobal("fetch", fetchMock)

    await linkAnalysisToStudent("auth|123", "job-1", null)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ student_id: null })
  })
})

describe("orgCreateStudent", () => {
  it("drops undefined and empty-string fields before POSTing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ student: {} }))
    vi.stubGlobal("fetch", fetchMock)

    await orgCreateStudent("auth|123", {
      full_name: "Alex Rivera",
      email: "",
      jersey_number: undefined,
      status: "active",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      full_name: "Alex Rivera",
      status: "active",
    })
  })
})

describe("orgImportStudents", () => {
  it("POSTs rows to /students/import", async () => {
    const result = { imported: 1, failed: [], duplicates_skipped: 0 }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(result))
    vi.stubGlobal("fetch", fetchMock)

    const res = await orgImportStudents("auth|123", [
      { full_name: "Al", status: "active" },
      { full_name: "Bo" },
    ])

    expect(res).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/org/auth%7C123/students/import")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      rows: [
        { full_name: "Al", status: "active" },
        { full_name: "Bo" },
      ],
    })
  })
})

describe("orgStudentTrends", () => {
  it("GETs the trends endpoint, encoding the student id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ trends: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgStudentTrends("auth|123", "stu/1")

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C123/students/stu%2F1/trends",
    )
  })

  it("appends metricKey/from/to filters when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ trends: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgStudentTrends("auth|123", "stu-1", {
      metricKey: "form_score",
      from: "2026-01-01",
      to: "2026-02-01",
    })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C123/students/stu-1/trends?metricKey=form_score&from=2026-01-01&to=2026-02-01",
    )
  })
})

describe("orgCompareStudents", () => {
  it("GETs the comparison endpoint with comma-joined ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ comparison: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgCompareStudents("auth|123", ["s1", "s2"])

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C123/students/comparison?ids=s1,s2",
    )
  })

  it("defaults metricKey to form_score and honors an override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ comparison: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await orgCompareStudents("auth|123", ["s1"], "sprint_speed")

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://localhost:3000/api/org/auth%7C123/students/comparison?ids=s1&metricKey=sprint_speed",
    )
  })
})

// Email routes live under /api/email/:auth0Id (NOT /api/org/:auth0Id/email)
// — see server/src/routes/email.ts. These tests pin the correct URL shape so
// a namespace regression fails loudly instead of 404-ing at runtime.
describe("email helpers", () => {
  it("orgSendInvites POSTs to /api/email/:auth0Id/invite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sent: [], total: 0, failed: 0 }))
    vi.stubGlobal("fetch", fetchMock)

    await orgSendInvites("auth|123", { emails: ["a@x.com", "b@x.com"] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/email/auth%7C123/invite")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ emails: ["a@x.com", "b@x.com"] })
  })

  it("orgEmailReport POSTs to /api/email/:auth0Id/report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sent: { id: "r", to: "a@x.com", subject: "s" } }))
    vi.stubGlobal("fetch", fetchMock)

    await orgEmailReport("auth|123", { report_id: "rep-1" })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/email/auth%7C123/report")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ report_id: "rep-1" })
  })

  it("orgEmailAttendance POSTs to /api/email/:auth0Id/attendance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sent: null, records: 0 }))
    vi.stubGlobal("fetch", fetchMock)

    await orgEmailAttendance("auth|123", { from: "2026-09-01", to: "2026-09-15" })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/email/auth%7C123/attendance")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ from: "2026-09-01", to: "2026-09-15" })
  })
})