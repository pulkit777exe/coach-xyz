import { describe, expect, test } from "bun:test";
import {
  isDate,
  isIsoDate,
  defaultReportTitle,
  REPORT_TYPE_LABELS,
  validateStudentRow,
  computeMetricTrends,
  round2,
} from "../src/lib/orgValidate";

describe("isDate", () => {
  test("accepts YYYY-MM-DD", () => {
    expect(isDate("2026-09-12")).toBe(true);
    expect(isDate("2000-01-01")).toBe(true);
  });

  test("rejects malformed formats", () => {
    expect(isDate("2026-9-12")).toBe(false);
    expect(isDate("2026/09/12")).toBe(false);
    expect(isDate("today")).toBe(false);
    expect(isDate("20260912")).toBe(false);
    expect(isDate("")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isDate(null)).toBe(false);
    expect(isDate(undefined)).toBe(false);
    expect(isDate(20260912)).toBe(false);
    expect(isDate(new Date("2026-09-12"))).toBe(false);
  });

  test("is format-only: calendar validity is left to the DB", () => {
    expect(isDate("2026-13-01")).toBe(true);
    expect(isDate("2026-02-31")).toBe(true);
  });
});

describe("isIsoDate", () => {
  test("accepts parseable date strings", () => {
    expect(isIsoDate("2026-09-12")).toBe(true);
    expect(isIsoDate("2026-09-12T18:30:00Z")).toBe(true);
    expect(isIsoDate("2026-09-12T18:30:00.000+05:30")).toBe(true);
  });

  test("rejects unparseable values", () => {
    expect(isIsoDate("not-a-date")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate(12345)).toBe(false);
  });
});

describe("defaultReportTitle", () => {
  test("prepends the student name for known types", () => {
    expect(defaultReportTitle("progress", { full_name: "Alex Rivera" })).toBe(
      "Alex Rivera — Progress Report",
    );
    expect(defaultReportTitle("monthly", { full_name: "Alex Rivera" })).toBe(
      "Alex Rivera — Monthly Summary",
    );
  });

  test("falls back to Organization when no student", () => {
    expect(defaultReportTitle("progress", null)).toBe(
      "Organization — Progress Report",
    );
    expect(defaultReportTitle("attendance", null)).toBe(
      "Organization — Attendance Report",
    );
  });

  test("falls back to Report for unknown scope types", () => {
    expect(
      defaultReportTitle("unknown-type", { full_name: "Alex Rivera" }),
    ).toBe("Alex Rivera — Report");
  });
});

describe("REPORT_TYPE_LABELS", () => {
  test("covers every supported report type", () => {
    expect(REPORT_TYPE_LABELS).toMatchObject({
      progress: expect.any(String),
      attendance: expect.any(String),
      performance: expect.any(String),
      monthly: expect.any(String),
    });
  });
});

describe("validateStudentRow", () => {
  test("accepts a minimal valid row (full_name only)", () => {
    const res = validateStudentRow({ full_name: "Alex Rivera" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cleaned).toEqual({ full_name: "Alex Rivera" });
  });

  test("trims whitespace around full_name", () => {
    const res = validateStudentRow({ full_name: "  Alex Rivera  " });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cleaned.full_name).toBe("Alex Rivera");
  });

  test("rejects a row without full_name", () => {
    const res = validateStudentRow({ email: "a@x.com" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("full_name");
  });

  test("accepts valid status values", () => {
    for (const status of ["active", "inactive", "transferred"]) {
      const res = validateStudentRow({ full_name: "Al", status });
      expect(res.ok).toBe(true);
    }
  });

  test("rejects unknown status values", () => {
    const res = validateStudentRow({ full_name: "Al", status: "bench" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("status must be one of");
  });

  test("accepts numeric jersey_number", () => {
    const res = validateStudentRow({ full_name: "Al", jersey_number: 7 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cleaned.jersey_number).toBe(7);
  });

  test("accepts numeric jersey_number passed as a string", () => {
    const res = validateStudentRow({ full_name: "Al", jersey_number: "9" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cleaned.jersey_number).toBe(9);
  });

  test("rejects non-numeric jersey_number", () => {
    const res = validateStudentRow({ full_name: "Al", jersey_number: "nine" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("jersey_number must be a number");
  });

  test("accepts YYYY-MM-DD dates", () => {
    const res = validateStudentRow({
      full_name: "Al",
      date_of_birth: "2010-01-15",
      joined_on: "2024-08-01",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cleaned.date_of_birth).toBe("2010-01-15");
      expect(res.cleaned.joined_on).toBe("2024-08-01");
    }
  });

  test("rejects malformed dates", () => {
    expect(
      validateStudentRow({ full_name: "Al", date_of_birth: "01/15/2010" }).ok,
    ).toBe(false);
    expect(
      validateStudentRow({ full_name: "Al", date_of_birth: "not-a-date" }).ok,
    ).toBe(false);
    expect(
      validateStudentRow({ full_name: "Al", joined_on: "Aug 2024" }).ok,
    ).toBe(false);
  });

  test("drops empty optional fields", () => {
    const res = validateStudentRow({
      full_name: "Al",
      email: "",
      phone: "",
      status: "",
      sport: "",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cleaned.email).toBeUndefined();
      expect(res.cleaned.status).toBeUndefined();
    }
  });
});

describe("computeMetricTrends", () => {
  const series = [
    {
      measured_at: "2026-01-01T00:00:00Z",
      metric_key: "form_score",
      metric_value: 6,
      unit: "/10",
      source: "analysis" as const,
    },
    {
      measured_at: "2026-02-01T00:00:00Z",
      metric_key: "form_score",
      metric_value: 7,
      unit: "/10",
      source: "analysis" as const,
    },
    {
      measured_at: "2026-03-01T00:00:00Z",
      metric_key: "form_score",
      metric_value: 8,
      unit: "/10",
      source: "analysis" as const,
    },
    {
      measured_at: "2026-01-10T00:00:00Z",
      metric_key: "sprint_speed",
      metric_value: 9.5,
      unit: "m/s",
      source: "manual" as const,
    },
  ];

  test("groups by metric_key", () => {
    const trends = computeMetricTrends(series);
    expect(trends.map((t) => t.metric_key).sort()).toEqual([
      "form_score",
      "sprint_speed",
    ]);
  });

  test("computes latest, avg and change", () => {
    const trends = computeMetricTrends(series);
    const form = trends.find((t) => t.metric_key === "form_score");
    expect(form?.latest).toBe(8);
    expect(form?.avg).toBe(7);
    expect(form?.change).toBe(2);
  });

  test("sorts points chronologically", () => {
    const trends = computeMetricTrends(series);
    const form = trends.find((t) => t.metric_key === "form_score");
    expect(form?.points.map((p) => p.measured_at)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-02-01T00:00:00Z",
      "2026-03-01T00:00:00Z",
    ]);
  });

  test("returns null latest/avg/change for empty groupings", () => {
    expect(computeMetricTrends([])).toEqual([]);
  });

  test("round2 rounds to two decimals", () => {
    expect(round2(7.3333)).toBe(7.33);
    expect(round2(2.375)).toBe(2.38);
  });
});
