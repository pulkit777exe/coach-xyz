import { describe, expect, it } from "vitest"
import { toISODate, toISOTime } from "../date"

describe("toISODate", () => {
  it("pads month and day to two digits", () => {
    expect(toISODate(new Date(2026, 0, 2))).toBe("2026-01-02")
    expect(toISODate(new Date(2026, 8, 5))).toBe("2026-09-05")
  })

  it("keeps two-digit month/day intact", () => {
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31")
    expect(toISODate(new Date(2026, 9, 16))).toBe("2026-10-16")
  })

  it("uses the local (not UTC) calendar day", () => {
    // new Date(2026, 5, 1) is June 1 in local time
    expect(toISODate(new Date(2026, 5, 1))).toBe("2026-06-01")
  })

  it("handles invalid dates without crashing (NaN components)", () => {
    expect(toISODate(new Date("not-a-date"))).toBe("NaN-NaN-NaN")
  })
})

describe("toISOTime", () => {
  it("pads hours and minutes to two digits", () => {
    expect(toISOTime(new Date(2026, 0, 1, 9, 5))).toBe("09:05")
    expect(toISOTime(new Date(2026, 0, 1, 0, 0))).toBe("00:00")
  })

  it("keeps two-digit values intact", () => {
    expect(toISOTime(new Date(2026, 0, 1, 23, 59))).toBe("23:59")
    expect(toISOTime(new Date(2026, 0, 1, 14, 30))).toBe("14:30")
  })

  it("is local time, not UTC", () => {
    // 08:15 local on 2026-01-01
    expect(toISOTime(new Date(2026, 0, 1, 8, 15))).toBe("08:15")
  })
})