import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── A failed month navigation exported a spreadsheet that lied about its own name ──────
//
// Both month-navigable views set the DISPLAYED month before fetching it:
//
//   const nav = (delta) => { const next = new Date(year, monthNum + delta, 1)
//                           setMonth(next); fetchMonth(next) }
//
// so when the fetch failed the previous month's data stayed on screen under the new month's
// heading. `AttendanceGrid` made it a number about nothing — the per-row total rendered
// `oldMonthPresent / newMonthDays`, a ratio across two different months.
//
// **The export is the part that mattered.** `exportCSV` names the file from the DISPLAYED
// month and writes rows from `records` / `events`, which after a failed navigation belong to
// the previous one. A coach exported `attendance-2026-11.csv` containing October's rows, or
// `schedule-2026-11.csv` containing October's fixtures. A missing file is recoverable; a
// spreadsheet whose contents contradict its filename is the kind of wrong that gets trusted.
//
// The fix keys the DATA on the month it holds (`recordsMonth` / `eventsMonth`) rather than
// on a boolean, for the reason `TeamsClient` does the same: a bare `loaded` flag cannot say
// which read it belongs to, and survives the very navigation that made it wrong. Then the
// export refuses while the two disagree, rather than writing the file anyway.
//
// Source assertions — the derivations sit inside components with hooks and fetches, so
// asserting them by rendering means standing up the whole grid. What a source assertion CAN
// settle here is a key, a comparison and a guard clause, and each is mutation-checked.

const ROOT = join(import.meta.dirname, '..', '..')
const grid = readFileSync(join(ROOT, 'components', 'org', 'AttendanceGrid.tsx'), 'utf8')
const schedule = readFileSync(join(ROOT, 'components', 'org', 'ScheduleClient.tsx'), 'utf8')

const CASES = [
  {
    name: 'AttendanceGrid',
    src: grid,
    key: 'recordsMonth',
    data: 'records',
    exportName: 'attendance-',
  },
  {
    name: 'ScheduleClient',
    src: schedule,
    key: 'eventsMonth',
    data: 'events',
    exportName: 'schedule-',
  },
] as const

describe("a month view never presents one month's data under another's name", () => {
  for (const c of CASES) {
    test(`${c.name}: the data is keyed to the month it actually holds`, () => {
      expect(c.src).toContain(`const [${c.key}, set${c.key[0].toUpperCase()}${c.key.slice(1)}]`)
      // The success path must ADVANCE the key — that is what makes the two agree at all.
      expect(c.src).toMatch(new RegExp(`set${c.key[0].toUpperCase()}${c.key.slice(1)}\\(`))
      // And the failure path must NOT, or the mismatch becomes undetectable.
      const catchIdx = c.src.indexOf('} catch (err) {')
      expect(catchIdx).toBeGreaterThan(-1)
      const afterCatch = c.src.slice(catchIdx, catchIdx + 400)
      expect(afterCatch, 'the catch must not advance the month key').not.toMatch(
        new RegExp(`set${c.key[0].toUpperCase()}${c.key.slice(1)}\\(`),
      )
      expect(afterCatch).toContain('setMonthFailed(true)')
    })

    test(`${c.name}: staleness is DERIVED by comparing the two months`, () => {
      // Not a stored boolean — a boolean cannot name the month it is about, and would
      // survive the navigation that makes it wrong.
      expect(c.src).toContain('displayedMonth')
      expect(c.src).toMatch(/AreStale = \w+ !== null && \w+ !== displayedMonth/)
      expect(c.src).toMatch(/canExport = \w+ === displayedMonth && !loading/)
    })

    test(`${c.name}: the export refuses rather than writing a mislabelled file`, () => {
      const expIdx = c.src.indexOf('const exportCSV')
      expect(expIdx).toBeGreaterThan(-1)
      const body = c.src.slice(expIdx, c.src.indexOf('downloadCSV', expIdx))
      expect(body, 'exportCSV must bail before downloadCSV when canExport is false').toContain(
        'if (!canExport) return',
      )
      // …and the button must say so rather than failing silently on click.
      expect(c.src).toContain('disabled={!canExport}')
      expect(c.src).toMatch(/title=\{\s*canExport/)
    })

    test(`${c.name}: the stale state is VISIBLE, not just prevented`, () => {
      // Preventing the bad export is half of it. Without a banner the grid is still silently
      // wrong: right heading, wrong rows, and a toast that has already gone.
      expect(c.src).toMatch(/AreStale && \(/)
      expect(c.src).toMatch(/role="status"/)
      expect(c.src).toMatch(
        /failed to load, so the (marks|events) below are from a different month/,
      )
      // Not short-circuited. `/AreStale && (/` is satisfied by `{false && areStale && (`, so
      // the first version of this assertion stayed green when I disabled the banner outright
      // — the `if (false)` mutation that has bitten this repo's guards repeatedly, here hiding
      // inside a chain rather than on its own line where the eye would catch it.
      expect(c.src, `${c.name}: the stale banner must not be short-circuited`).not.toMatch(
        /(?:false|undefined)\s*&&\s*\w*AreStale &&/,
      )
    })

    test(`${c.name}: the empty-state copy is suppressed while stale`, () => {
      // "No events in November. Click any day to add one." is false after a failed navigation
      // — the coach has events, just not the ones on screen.
      //
      // Only asserted where such a copy EXISTS. `AttendanceGrid` renders every day of the
      // month, so it has no "no records" state to suppress; my first version asserted the
      // guard on both files and failed on a file that has nothing to suppress. Two views that
      // share a defect are not thereby identical, and a guard that assumes they are will
      // demand a change nobody should make.
      const hasEmptyCopy = /No events in \$\{monthLabel\}|No attendance|No records/i.test(c.src)
      if (hasEmptyCopy) {
        expect(
          c.src,
          `${c.name} has an empty-state copy, so it must be suppressed while stale`,
        ).toMatch(/\{!eventsAreStale|\{!recordsAreStale/)
      }
      // Either way the STALE banner is required — that is what tells the user why.
      expect(c.src).toMatch(/AreStale && \(/)
    })
  }

  test('the two views agree on the mechanism, so the defect cannot be fixed in one only', () => {
    // They are twins: same `setMonth`-before-fetch order, same export naming bug. Asserted
    // as a pair so fixing one and not the other is visible in this file.
    for (const c of CASES) {
      expect(c.src).toContain('setMonth(next)')
      expect(c.src).toContain(c.exportName)
      expect(c.src).toContain('if (!canExport) return')
    }
  })

  test("the files being asserted on still contain the defects' landmarks", () => {
    // So a rename cannot leave this passing against files that no longer exist.
    expect(grid).toContain('AttendanceGrid')
    expect(schedule).toContain('ScheduleClient')
    expect(grid).toContain('downloadCSV')
    expect(schedule).toContain('downloadCSV')
  })
})
