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
          "export const A = () => <span>{new Date(a.requested_at).toLocaleDateString('en-US', {",
          "  month: 'short', day: 'numeric', year: 'numeric',",
          '})}</span>',
          'export const B = () => <span>{new Date(b.done_at).toLocaleString()}</span>',
        ].join('\n'),
      )
      // Through `scan`, not a private re-read — so disabling `scan` breaks this too.
      const found = scan(['lib/__fixture_date'])
      expect(found).toHaveLength(2)
      expect(found.every((f) => !f.exempt)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(SOURCE_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(100)
  })

  test('the exemptions are only month-only formats', () => {
    // Named, because "the exempt ones look fine" is a belief and this asserts it. If a
    // full date format ever lands here it must fail, not pass on a loose shape.
    for (const s of sites.filter((x) => x.exempt)) {
      expect(s.text).toMatch(MONTH_ONLY)
      // …and it must not ALSO carry a day, which is the whole distinction.
      expect(s.text).not.toMatch(/day:\s*'numeric'/)
    }
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
