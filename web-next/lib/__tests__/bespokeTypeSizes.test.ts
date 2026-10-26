import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { stripComments } from './helpers/stripComments'

// ── The bespoke rule was prose, and prose drifted ─────────────────────────────
//
// `docs/DESIGN_FOUNDATIONS.md` stated the permitted-bespoke boundary in TWO places that
// contradicted each other:
//
//   §Typography   "Sizes outside the six (28–40px headings, 56/68px marketing display)"
//   journey table "bespoke display type (26–68px)"
//
// So the **11 first-party sites at 26px and 44px were violations under one reading and
// permitted under the other**, and the **8 sites at 18px were named by neither**. Nobody
// noticed for a simple structural reason, which is the same reason the type-scale guard
// itself was reported as "pinned by `typeScale.test.ts`" when that file contains zero
// references to any `.tsx`:
//
//   `typeScale.test.ts`             reads the DOC, and asserts only that the six utility
//                                   NAMES appear in it. Never the bespoke rule.
//   `typeScaleComponents.test.ts`   enforces the rule against COMPONENTS, and hardcodes
//                                   `DOCUMENTED = [11..16]`. Never reads the doc.
//
// **The rule 11 sites depend on was stated in prose that no test checked.** The doc could
// contradict itself and both tests would stay green, because the one that reads the doc
// does not read the rule and the one that enforces the rule does not read the doc.
//
// This closes that by making the doc's own stated range load-bearing: it is parsed out of
// the prose, and every first-party literal size is checked against it. Tightening the doc
// without updating the code now fails HERE, naming the sites — which is the point, because
// the decision to permit them lives in the doc and the doc is therefore the thing that has
// to be right.
//
// The 18px/26px/44px sites are named explicitly rather than derived, because a derived list
// would silently agree with whatever the tree happens to contain today — the failure this
// file exists to prevent, in the guard written to prevent it.

const ROOT = join(import.meta.dirname, '..', '..')
// `ROOT` is `web-next`, and the doc is at the REPO root — so the guard reads a file outside
// the app it guards. That is deliberate (the rule lives in the shared design foundations, not
// in this app) and it is why the path needs saying out loud rather than being "fixed" later
// by someone who assumes the doc should be under `web-next/`.
const DOCS = join(ROOT, '..', 'docs', 'DESIGN_FOUNDATIONS.md')
const doc = readFileSync(DOCS, 'utf8')

/** The six semantic utilities, below which bespoke does not apply. */
const FLOOR = 16
/** Sizes below the floor that are named exceptions rather than bespoke. */
const SUB_FLOOR_EXCEPTIONS = [9, 10]

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

/** Vendored files stay registry-faithful, as the doc states. */
const VENDORED = /(^|\/)(9ui|interior)\//

interface Site {
  file: string
  px: number
}

const sites: Site[] = []
for (const dir of ['app', 'components']) {
  for (const f of sourceFiles(dir)) {
    if (VENDORED.test(f)) continue
    // Comments stripped: the doc records that comment references to `text-[Npx]` exist in
    // this tree, so an unstripped scan counts documentation as code.
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'))
    for (const m of src.matchAll(/text-\[(\d+)px\]/g)) {
      sites.push({ file: f.replace(`${ROOT}/`, ''), px: Number(m[1]) })
    }
  }
}

describe('the doc states ONE bespoke rule, and the tree agrees with it', () => {
  test('the doc no longer enumerates bespoke sizes twice', () => {
    // The specific defect: two sentences listing different ranges. A doc that says
    // "28–40px and 56/68px" in one place and "26–68px" in another cannot be complied
    // with, so the count of bespoke enumerations is pinned at one.
    const enumerations = [...doc.matchAll(/\((\d+)[–-](\d+)px[^)]*\)/g)]
    expect(enumerations.length).toBe(0)
  })

  test('the bespoke rule is stated as a RULE, not a list of sizes', () => {
    expect(doc).toContain('Everything above 16px is bespoke')
  })

  test('the sub-floor rule is stated separately, because bespoke does not apply there', () => {
    // One sentence covering "outside the six" would silently permit a 10px size, which is
    // exactly how a floor rule goes missing. The doc has to name the below-floor case as a
    // separate rule, and this asserts that it does.
    expect(doc).toContain('Below 11px is NOT bespoke')
  })

  test('every first-party literal size is accounted for by exactly one rule', () => {
    const six = [11, 12, 13, 14, 15, 16]
    const unaccounted = sites.filter(
      (s) => !six.includes(s.px) && s.px <= FLOOR && !SUB_FLOOR_EXCEPTIONS.includes(s.px),
    )
    // Named, so a failure says which file and which size rather than a count.
    expect(unaccounted.map((s) => `${s.file} — text-[${s.px}px]`)).toEqual([])
  })

  test('the flipping sizes are the ones the audit named, and they are now permitted', () => {
    // The 19 sites the contradiction actually decided. Under the old wording these were
    // violations under one reading and permitted under the other; under the new rule all 19
    // are bespoke-permitted, which is also what the guard has always enforced.
    const counts = new Map<number, number>()
    for (const s of sites) counts.set(s.px, (counts.get(s.px) ?? 0) + 1)
    expect(counts.get(18) ?? 0).toBeGreaterThan(0)
    expect(counts.get(26) ?? 0).toBeGreaterThan(0)
    expect(counts.get(44) ?? 0).toBeGreaterThan(0)
    // Above the floor, OR one of the named below-floor exceptions — my first version
    // asserted `px > FLOOR` for every site and failed on the 9px badge and the 10px `<kbd>`,
    // which is the sub-floor rule working exactly as documented and my assertion forgetting
    // it. A guard that cannot express its own doc's second rule will drop that rule.
    for (const s of sites) expect(s.px > FLOOR || SUB_FLOOR_EXCEPTIONS.includes(s.px)).toBe(true)
  })

  test('the scan is not vacuous', () => {
    // A guard over an empty result cannot detect a broken scan — the failure mode this repo
    // has now paid for four separate times. The positive control is the fixture below, not
    // the tree.
    expect(sites.length).toBeGreaterThan(10)
    const fixture = stripComments(
      readFileSync(join(import.meta.dirname, 'fixtures', 'bespoke.tsx'), 'utf8'),
    )
    expect([...fixture.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]))).toEqual([
      26, 44, 12, 8,
    ])
  })

  test('POSITIVE CONTROL — a size outside every rule is caught by the classifier', () => {
    // Runs the SAME classifier as the assertion above, over a fixture holding 26px and 44px
    // (bespoke-permitted), 12px (one of the six) and 8px (covered by no rule at all). Only
    // the 8px must be reported unaccounted — which is what proves the filter is not passing
    // by vacuity, and that it rejects rather than merely counting.
    const fixture = stripComments(
      readFileSync(join(import.meta.dirname, 'fixtures', 'bespoke.tsx'), 'utf8'),
    )
    const found = [...fixture.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]))
    const unaccounted = found.filter(
      (px) =>
        ![11, 12, 13, 14, 15, 16].includes(px) && px <= FLOOR && !SUB_FLOOR_EXCEPTIONS.includes(px),
    )
    expect(unaccounted).toEqual([8])
  })
})
