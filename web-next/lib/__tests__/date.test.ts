import { describe, expect, it } from "vitest"
import { toISODate, toISOTime, scheduleMonthWindow } from "../date"

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

describe("scheduleMonthWindow", () => {
  it("runs midnight-to-23:59 with one day of buffer on each side", () => {
    const { from, to } = scheduleMonthWindow(new Date(2026, 3, 15))
    // April 2026: prev month's last day is Mar 31, next month's first is May 1
    expect(from.getFullYear()).toBe(2026)
    expect(from.getMonth()).toBe(2)
    expect(from.getDate()).toBe(31)
    expect([from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([0, 0, 0])
    expect(to.getFullYear()).toBe(2026)
    expect(to.getMonth()).toBe(4)
    expect(to.getDate()).toBe(1)
    expect([to.getHours(), to.getMinutes(), to.getSeconds()]).toEqual([23, 59, 59])
  })

  it("rolls a January window back into the previous December", () => {
    const { from } = scheduleMonthWindow(new Date(2026, 0, 10))
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2025, 11, 31])
  })

  it("rolls a December window forward into the next January", () => {
    const { to } = scheduleMonthWindow(new Date(2026, 11, 5))
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2027, 0, 1])
  })

  it("uses a one-day buffer by default (May 31 -> Jun buffer -> Jul 1)", () => {
    const { from, to } = scheduleMonthWindow(new Date(2026, 5, 1))
    expect([from.getMonth(), from.getDate()]).toEqual([4, 31])
    expect([to.getMonth(), to.getDate()]).toEqual([6, 1])
  })

  it("honors a custom buffer size", () => {
    const { from, to } = scheduleMonthWindow(new Date(2026, 5, 1), 2)
    // June 2026 with a 2-day buffer -> May 30 00:00 .. Jul 2 23:59:59
    expect(from).toStrictEqual(new Date(2026, 4, 30, 0, 0, 0))
    expect(to).toStrictEqual(new Date(2026, 6, 2, 23, 59, 59))
  })

  it("ignores the time-of-day of the input date", () => {
    const { from } = scheduleMonthWindow(new Date(2026, 3, 15, 14, 30, 0))
    expect([from.getMonth(), from.getDate(), from.getHours()]).toEqual([2, 31, 0])
  })
})