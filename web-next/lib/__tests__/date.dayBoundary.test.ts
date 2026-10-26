import { describe, expect, test } from 'vitest'
import {
  formatDateMed,
  formatDateNumeric,
  formatDateShort,
  formatDateTime,
  formatDayWeekday,
  formatDayWeekdayYear,
} from '@/lib/date'

// ── Twelve sites formatted a full ISO datetime as an INSTANT, not a calendar day ──
//
// `lib/date.ts` existed precisely to stop this, and its own comment records the bug it was
// written for: "a 23:30Z analysis and a 23:45Z one displayed as 'Sep 13' and 'Sep 14' in
// UTC+1 while the formatDateMed rows beside them in the same column both said 'Sep 13'".
//
// **Twelve call sites never received the fix.** They did `new Date(a.requested_at)
// .toLocaleDateString('en-US', {...})`, which resolves the instant in the VIEWER's timezone
// — so an analysis recorded at 23:45Z on Oct 6 read as **Oct 7** in every timezone east of
// UTC, while the `formatDateMed` cell beside it in the same row said Oct 6.
//
// Measured, not asserted from reading: Europe/Berlin and Pacific/Auckland both render
// `Oct 7, 2026` for that instant where the SSOT renders `Oct 6, 2026`. UTC agrees, which is
// why this passed every review by anyone whose clock is set to UTC — including this file's
// own author.
//
// THE TEST SETS `process.env.TZ` because the bug is invisible otherwise. That is the point:
// a test that only runs in the author's timezone cannot catch a bug that only exists in
// somebody else's.

const REAL_TZ = process.env.TZ
const inTz = (tz: string, fn: () => void) => {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = REAL_TZ
  }
}

/** An instant recorded late in the UTC day — the shape that crosses the date line. */
const LATE_UTC = '2026-10-06T23:45:00Z'

describe('the SSOT reads the calendar day out of the STRING, not the instant', () => {
  test('a late-evening UTC instant keeps its own day east of UTC', () => {
    for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland', 'Asia/Kolkata']) {
      inTz(tz, () => {
        expect(formatDateMed(LATE_UTC)).toBe('Oct 6, 2026')
        expect(formatDateShort(LATE_UTC)).toBe('Oct 6')
        expect(formatDayWeekday(LATE_UTC)).toBe('Tue, Oct 6')
        expect(formatDayWeekdayYear(LATE_UTC)).toBe('Tue, Oct 6, 2026')
      })
    }
  })

  test('THE DEFECT: localizing the INSTANT disagrees with the SSOT east of UTC', () => {
    // The bypass shape, reproduced so the fix is not "the output changed and I saw a
    // screenshot". If this ever starts agreeing, the assertion below that the SSOT is
    // TZ-invariant is no longer the distinguishing claim, and the file should be revisited.
    const bypass = (iso: string) =>
      new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    inTz('UTC', () => {
      expect(bypass(LATE_UTC)).toBe('Oct 6, 2026')
    })
    inTz('Europe/Berlin', () => {
      expect(bypass(LATE_UTC)).toBe('Oct 7, 2026')
      // …and the SSOT disagrees with it, which is the whole reason the helper exists.
      expect(formatDateMed(LATE_UTC)).not.toBe(bypass(LATE_UTC))
    })
  })

  test('every formatter is timezone-invariant; the bypass is not', () => {
    const forms = [
      formatDateMed,
      formatDateShort,
      formatDayWeekday,
      formatDayWeekdayYear,
      formatDateNumeric,
      formatDateTime,
    ]
    for (const fn of forms) {
      const seen = new Set<string>()
      for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland', 'America/New_York']) {
        inTz(tz, () => seen.add(fn(LATE_UTC)))
      }
      // `formatDateTime` is the deliberate exception and is asserted separately below.
      if (fn === formatDateTime) continue
      expect([...seen]).toHaveLength(1)
    }
  })

  test('formatDateTime keeps the local CLOCK time, which is the point of it', () => {
    // It is the one formatter that reads the instant, because a wall-clock time is what
    // the user is asking about — "when did this happen". So the DATE comes from the string
    // and the TIME from the instant, and only the time is allowed to vary by timezone.
    // Split on the locale's own separator rather than assuming commas: en-US renders
    // "October 6, 2026 at 11:45 PM", so the day and the clock time are separated by "at".
    // My first version split on ',' and compared the wrong half — the assertion was
    // measuring the month, not the time.
    const timePart = (s: string) => s.split(/ at /i)[1]?.trim() ?? ''
    const datePart = (s: string) => s.split(/ at /i)[0].trim()
    const dates: string[] = []
    const times: string[] = []
    for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland']) {
      inTz(tz, () => {
        const out = formatDateTime(LATE_UTC)
        dates.push(datePart(out))
        times.push(timePart(out))
      })
    }
    expect([...new Set(dates)]).toEqual(['October 6, 2026'])
    expect(new Set(times).size).toBeGreaterThan(1)
  })

  test('a bare YYYY-MM-DD is not shifted either', () => {
    // `localDay` parses it as LOCAL midnight, which is the other half of the fix: a bare
    // date parsed as UTC midnight reads as the previous day west of Greenwich.
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      inTz(tz, () => {
        expect(formatDateMed('2026-10-06')).toBe('Oct 6, 2026')
        expect(formatDateShort('2026-10-06')).toBe('Oct 6')
      })
    }
  })

  test('a full ISO datetime and its date part render identically', () => {
    // The property that makes the fix total: the helper's own contract is that the
    // calendar day comes from the string's first 10 characters, so a caller holding either
    // form gets the same answer.
    for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland']) {
      inTz(tz, () => {
        expect(formatDateMed('2026-10-06T23:45:00Z')).toBe(formatDateMed('2026-10-06'))
        expect(formatDateMed('2026-10-06T00:05:00Z')).toBe(formatDateMed('2026-10-06'))
      })
    }
  })

  test('formatDateNumeric is locale-pinned, not locale-dependent', () => {
    // KNOWN LIMIT, recorded rather than papered over: mutation D4 (removing the `'en-US'`
    // argument) leaves this suite GREEN, because the runtime's default locale in CI already
    // IS en-US — so a pinned locale and an absent one are indistinguishable in-process. The
    // `Intl` default is fixed at process start from `LANG`/`LC_ALL` and cannot be changed
    // mid-run, so proving the pin would need a child process with a different locale.
    //
    // What IS verified here is the half that is observable in-process: the output does not
    // vary with `TZ`. The locale half rests on reading the call, which is why the `'en-US'`
    // argument is inline rather than a shared default someone could drop once.
    // Two of the twelve sites called bare `toLocaleDateString()` with NO locale, so the
    // same instant rendered `10/6/2026` in one browser and `06/10/2026` in another — and on
    // a day-first locale the day and month swap places. A value that varies by machine is
    // not a value the design system owns.
    const seen = new Set<string>()
    for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland']) {
      inTz(tz, () => seen.add(formatDateNumeric('2026-10-06')))
    }
    expect([...seen]).toHaveLength(1)
    expect(formatDateNumeric('2026-10-06')).toBe('10/6/2026')
  })

  test('an unparseable value does not throw', () => {
    // Every one of these is reached from async response data, so a missing field produces
    // an empty string and `new Date('')` is Invalid Date. The UI must degrade, not crash.
    for (const bad of ['', '   ', 'not-a-date', 'null']) {
      expect(() => formatDateMed(bad)).not.toThrow()
      expect(() => formatDateTime(bad)).not.toThrow()
      expect(() => formatDateNumeric(bad)).not.toThrow()
    }
  })
})
