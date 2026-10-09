import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── No component formats a date itself ────────────────────────────────────────
//
// `lib/date.ts` exists to resolve the calendar day from a date STRING rather than from an
// INSTANT, because the two disagree for any timestamp near midnight in a timezone east of
// UTC. Its own comment records the bug it was written for, and its fix reached three of the
// sites that needed it.
//
// **Fifteen did not receive it.** They called `new Date(a.requested_at)
// .toLocaleDateString(...)`, so an analysis recorded at 23:45Z on Oct 6 read as **Oct 7**
// to every viewer east of UTC — while the `formatDateMed` cell beside it in the same row
// said Oct 6. Six more called bare `toLocaleString()` with no locale at all, so the same
// instant rendered differently per browser on top of the day shift.
//
// Why this needs a guard rather than a one-off sweep: the rule is invisible in review,
// because `new Date(x).toLocaleDateString(...)` is ordinary-looking code that reads
// correct. Nobody spots it. The class was found twice — once by an audit, once by a grep
// after the audit — and a third appearance would not be surprising.
//
// The exemptions are narrow and stated: `month: 'long', year: 'numeric'` renders a MONTH
// with no day component, so there is no day to get wrong, and it is deliberately left
// alone rather than routed through a formatter that would change its output.

const ROOT = join(import.meta.dirname, '..', '..')
if (!readdirSync(join(ROOT, 'app')).length) throw new Error(`bad ROOT: ${ROOT}`)

const SOURCE_DIRS = ['app', 'components', 'lib']

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** `path.relative`, not a manual slice — see the identical bug in `noBarrels.test.ts`. */
const rel = (f: string): string => relative(ROOT, f)

/** `new Date(<x>).toLocale<Date|Time>?String(...)`, with the args balanced. */
const DIRECT_FORMAT = /new Date\([^()]*\)\.toLocale(?:Date|Time)?String\(/g

/** A month-only format has no day component, so it cannot be off by one. */
const MONTH_ONLY = /month:\s*'long',\s*year:\s*'numeric'/

/**
 * `const x = new Date(<non-empty>)` — a Date BOUND to a variable.
 *
 * `DIRECT_FORMAT` only sees `new Date(x).toLocaleDateString(...)`, the single-expression
 * form. Split it across two statements and the guard sees nothing — which is not a theoretical
 * gap: `NotificationBell`'s deleted helper was exactly `const d = new Date(iso)` on one line
 * and `d.toLocaleTimeString(...)` three lines later, formatting a STORED timestamp while this
 * guard reported the tree clean. **The defect and the blind spot were the same site.**
 *
 * The argument must be non-empty: `new Date()` is "now", and formatting the current instant
 * in the viewer's timezone is correct — `OwnerHome.tsx:48` does precisely that and must not
 * be flagged.
 */
const DATE_BINDER = /\b(?:const|let)\s+(\w+)\s*=\s*new Date\([^)]/g

/** `x.toLocaleDateString(` — a variable receiver, invisible to `DIRECT_FORMAT`. */
const VARIABLE_RECEIVER = /\b(\w+)\??\.toLocale(?:Date|Time)?String\(/g

/**
 * `.toISOString().slice(0, 10)` — a UTC day where a local day belongs.
 *
 * This is the other half of the same bug: the CSV exports in `ReportsClient` and
 * `StudentsClient` named their file from `toISOString()`, so east of UTC just after midnight a
 * coach exported `roster-2026-10-05.csv` on the morning of the 6th.
 */
const UTC_DAY_SLICE = /\.toISOString\(\)\.slice\(0,\s*10\)/g

/**
 * A variable bound from `Date.UTC(...)` is deliberate UTC arithmetic, not a display day.
 * Stated as a property of the BINDING rather than as a `file:line` exemption, because a
 * line-number list rots silently the first time anyone edits the file above it.
 */
const UTC_BOUND = /\b(?:const|let)\s+(\w+)\s*=\s*new Date\(Date\.UTC\(/g

interface Site {
  file: string
  line: number
  text: string
  exempt: boolean
}

/**
 * The one scan. The tree-wide assertion and the positive control BOTH call this.
 *
 * They each had their own version, and disabling the tree-wide one left the suite GREEN —
 * the control was reading files and matching DIRECTLY, so it validated a code path that
 * nothing else used. **That is the fifth time in this repo a control has not shared the
 * code path it is meant to validate** (`typeScaleComponents`, `asyncParallel`, `noBarrels`,
 * `VideoPlayer.colors`, and now this), and it is worth naming as a habit rather than a
 * series of incidents: a control that re-implements the thing it controls proves only that
 * the re-implementation works.
 */
/**
 * The full call starting at `open` (the `(`), by paren balance.
 *
 * Passes 2 and 3 use this rather than each growing its own reader: two readers of the same
 * options object that disagreed would exempt a format in one pass and flag it in the next.
 */
const callWindow = (src: string, open: number): string => {
  let depth = 0
  for (let i = open; i < src.length && i < open + 400; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open, open + 400)
}

const scan = (dirs: string[] = SOURCE_DIRS): Site[] => {
  const out: Site[] = []
  for (const dir of dirs) {
    for (const f of sourceFiles(dir)) {
      if (rel(f) === 'lib/date.ts') continue // the SSOT uses localDay(), never new Date()
      const src = readFileSync(join(ROOT, f), 'utf8')
      for (const m of src.matchAll(DIRECT_FORMAT)) {
        // Read the whole call so a month-only format can be recognised rather than guessed.
        const open = m.index + m[0].length - 1
        let depth = 0
        let end = open
        for (let i = open; i < src.length && i < open + 400; i++) {
          if (src[i] === '(') depth++
          else if (src[i] === ')') {
            depth--
            if (depth === 0) {
              end = i
              break
            }
          }
        }
        out.push({
          file: rel(f),
          line: src.slice(0, m.index).split('\n').length,
          text: src.slice(m.index, end + 1),
          exempt: MONTH_ONLY.test(src.slice(open, end)),
        })
      }

      // Pass 2: a Date BOUND to a variable and then formatted. Invisible to `DIRECT_FORMAT`,
      // and this is not theoretical — `NotificationBell`'s deleted helper bound `d` on one
      // line and formatted it three lines later, formatting a stored timestamp while this
      // guard reported the tree clean. The defect and the blind spot were the same site.
      const bound = new Set([...src.matchAll(DATE_BINDER)].map((mm) => mm[1]))
      for (const m of src.matchAll(VARIABLE_RECEIVER)) {
        if (!bound.has(m[1])) continue
        const text = callWindow(src, m.index + m[0].length - 1)
        out.push({
          file: rel(f),
          line: src.slice(0, m.index).split('\n').length,
          text,
          exempt: MONTH_ONLY.test(text),
        })
      }

      // Pass 3: a UTC day used where a local day belongs — the CSV filename bug.
      const utcBound = new Set([...src.matchAll(UTC_BOUND)].map((mm) => mm[1]))
      for (const m of src.matchAll(UTC_DAY_SLICE)) {
        const before = src.slice(Math.max(0, m.index - 240), m.index)
        const recv = /(\w+)\s*$/.exec(before)?.[1] ?? ''
        const lineEnd = src.indexOf('\n', m.index)
        out.push({
          file: rel(f),
          line: src.slice(0, m.index).split('\n').length,
          text: src.slice(Math.max(0, m.index - 40), lineEnd === -1 ? src.length : lineEnd),
          // Exempt because of the BINDING, not because of the file: a line-number or
          // file:line exemption rots the first time someone edits above it.
          exempt: utcBound.has(recv),
        })
      }
    }
  }
  return out
}

const sites = scan()

describe('no component formats a date itself', () => {
  test('the matcher DETECTS the shape when it is present — the positive control', () => {
    // The matcher must demonstrably work, or "no violations" is indistinguishable from a
    // broken regex — the failure mode this repo has now paid for four separate times.
    //
    // My first control asserted that `lib/date.ts` itself matched, and it does NOT: the
    // SSOT calls `localDay(iso).toLocaleDateString(...)`, never `new Date(...).`, precisely
    // because it needs the string-parsed day. So the control was asserting something about
    // the SSOT that is false by design, and it failed for the right reason.
    //
    // The control is therefore a FIXTURE carrying the real bypass shape.
    const dir = join(ROOT, 'lib', '__fixture_date')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(
        join(dir, 'x.tsx'),
        [
          // Pass 1: the single-expression form.
          "export const A = () => <span>{new Date(a.requested_at).toLocaleDateString('en-US', {",
          "  month: 'short', day: 'numeric', year: 'numeric',",
          '})}</span>',
          'export const B = () => <span>{new Date(b.done_at).toLocaleString()}</span>',
          '',
          "// Pass 2: the TWO-STATEMENT form — `NotificationBell`'s actual bug.",
          'export const C = () => {',
          '  const d = new Date(c.created_at)',
          "  return <span>{d.toLocaleTimeString('en-US', { hour: 'numeric' })}</span>",
          '}',
          '',
          '// Pass 3: a UTC day in a filename, NOT bound from Date.UTC.',
          'export const name = () => `roster-${new Date(e.created_at).toISOString().slice(0, 10)}.csv`',
          '',
          '// The exemption: a MONTH-only format has no day component to get wrong.',
          "export const F = () => <span>{new Date(f.period_start).toLocaleDateString('en-US', {",
          "  month: 'long',",
          "  year: 'numeric',",
          '})}</span>',
        ].join('\n'),
      )
      // Through `scan`, not a private re-read — so disabling `scan` breaks this too.
      // FIVE because there are three passes plus one exemption: if any pass stops matching,
      // this count drops and the control goes red rather than quietly shrinking its own
      // coverage. The single exempt site is the month-only one, which is the only place that
      // rule is exercised AT ALL — in the real tree it currently matches nothing, because the
      // tree's month-only formats use a variable receiver that passes 1 and 2 do not target.
      // **An exemption with no case is inert, and inert is indistinguishable from working**,
      // so it lives here where a change to MONTH_ONLY fails this assertion.
      const found = scan(['lib/__fixture_date'])
      expect(found).toHaveLength(5)
      expect(found.filter((x) => x.exempt).map((x) => x.text)).toHaveLength(1)
      expect(found.filter((x) => x.exempt)[0].text).toMatch(MONTH_ONLY)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(SOURCE_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(100)
  })

  test('the exemptions are only month-only formats or a Date.UTC binding', () => {
    // Named, because "the exempt ones look fine" is a belief and this asserts it. Two
    // exemptions exist and each is checked by ITS OWN rule, so neither can absorb the other:
    // a full-date format must not pass as month-only, and a local day must not pass as UTC
    // arithmetic just because it sits near a `.slice(0, 10)`.
    let monthOnly = 0
    let utcBound = 0
    for (const s of sites.filter((x) => x.exempt)) {
      if (MONTH_ONLY.test(s.text)) {
        monthOnly++
        // …and it must not ALSO carry a day, which is the whole distinction.
        expect(s.text).not.toMatch(/day:\s*'numeric'/)
      } else {
        utcBound++
        // The only other exemption, and it is a property of the binding: the receiver is
        // built from `Date.UTC`, so the day was assembled in UTC on purpose.
        expect(s.text).toMatch(UTC_DAY_SLICE)
        expect(s.text).toMatch(/toISOString\(\)/)
      }
    }
    // Counts asserted rather than implied: if either exemption stopped being produced the
    // loop would simply run fewer times and pass. The tree carries one of each today, and a
    // silent change to either rule moves these numbers.
    // `monthOnly` is deliberately NOT asserted above zero: it is genuinely 0 in this tree
    // (the month-only formats use a `month` receiver that passes 1 and 2 do not target), and
    // asserting a number that only happens to be zero would make this the second inert
    // assertion in the file. Its rule is proven in the positive control instead. What is
    // asserted here is that BOTH branches are reachable by rule and that the one exemption
    // the tree actually carries is the UTC binding.
    expect(monthOnly + utcBound).toBe(sites.filter((x) => x.exempt).length)
    expect(utcBound).toBe(1)
  })

  test('no site formats a full ISO datetime as an instant', () => {
    // Named in full so a new offender fails with its file and line, not a count.
    const offenders = sites.filter((s) => !s.exempt).map((s) => `${s.file}:${s.line} — ${s.text}`)
    expect(offenders).toEqual([])
  })

  test('lib/date.ts is the only module that formats a Date it constructed', () => {
    // KNOWN LIMITS of this guard, established by mutation rather than assumed:
    //
    //  - Disabling `sites` (mutation G2) and emptying `offenders` (G3) both stay GREEN,
    //    because the tree is clean and an empty result is what a correct scan produces.
    //    They are caught EXTERNALLY instead: a `new Date(...).toLocaleDateString(...)` was
    //    planted in a real component and turned this file red (G1). That is weaker than a
    //    self-check and is the honest statement of where it stands.
    //  - Removing the `lib/date.ts` exclusion (G6) also stays GREEN, because the SSOT
    //    never matches `DIRECT_FORMAT` anyway: it calls `localDay(iso)`, never
    //    `new Date(...)`, precisely because it needs the string-parsed day. **The
    //    exclusion is therefore defensive and currently inert** — kept because a future
    //    formatter inside `date.ts` that does construct a Date should not trip its own
    //    guard, and recorded so nobody reads it as load-bearing.
    // The other direction, and the one that catches a new formatter added beside the SSOT
    // instead of inside it — which is how a second set of divergent date semantics starts.
    const otherFormatters = sourceFiles('lib').filter((f) => {
      if (rel(f) === 'lib/date.ts') return false
      const src = readFileSync(join(ROOT, f), 'utf8')
      return /toLocale(Date|Time)?String\(/.test(src)
    })
    expect(otherFormatters.map(rel)).toEqual([])
  })
})
