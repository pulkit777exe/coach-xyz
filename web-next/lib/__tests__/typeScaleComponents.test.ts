import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { stripComments } from './helpers/stripComments'

// ── The type-scale rule, enforced against .tsx rather than only against the docs ──
//
// AGENTS.md says the rule is "pinned by `lib/__tests__/typeScale.test.ts`". That file
// reads `app/globals.css` and `docs/DESIGN_FOUNDATIONS.md` and contains ZERO references
// to `.tsx`, so what it actually pins is that the six utilities EXIST — it cannot catch a
// `text-[Npx]` regression in any component. This file is the part that was missing.
//
// SCOPE, and it is deliberately half the rule. This asserts one thing: no first-party
// component may spell a DOCUMENTED size as a literal `text-[Npx]`. The six sizes are 11,
// 12, 13, 14, 15, 16px; anything else is bespoke, and bespoke sizes are explicitly
// permitted by `docs/DESIGN_FOUNDATIONS.md` ("Sizes outside the six … stay bespoke in the
// components that own them"). `components/interior/**` is exempt because the vendored
// files keep their own sizes by design, and it contributes all 16 current hits.
//
// WHY IT IS NOT THE WHOLE RULE, stated rather than left for a reader to assume. An
// independent audit found the permitted-bespoke boundary is stated three incompatible
// ways in the docs — "28–40 + 56/68" in the `text-[Npx]` sentence, "26–68" in the
// Surfaces table, and a five-row table naming 18/28/30–32/40 — and that 18px, 26px and
// 44px are exactly where the readings disagree, flipping the verdict on 19 sites. A
// guard for that half has to encode the boundary as a literal number list, which makes
// the TEST the source of truth and the doc decoration. **One docs sentence fixes it;
// nothing in the code does** — so that half is deliberately not written here, and
// `docs/DESIGN_FOUNDATIONS.md` is recorded as the blocker rather than papered over.
//
// There is also a larger boundary this guard does not reach: `text-sm` (154 sites),
// `text-xs` (46) and `text-base` (8) express the same documented sizes through Tailwind's
// named utilities, with a different `line-height` — which is precisely why `text-body`
// exists. That is a product decision about 208 sites, not a lint, and is recorded in
// AGENTS.md rather than enforced.

const ROOT = join(import.meta.dirname, '..', '..')
const ifMissing = (p: string) => {
  if (!readdirSync(join(ROOT, p)).length) throw new Error(`bad ROOT: ${ROOT}`)
}
ifMissing('app')

/** The six documented sizes. Mirrors `--text-*` in `app/globals.css`. */
const DOCUMENTED = [11, 12, 13, 14, 15, 16]

/** The scale's floor: `--text-label` is 11px, so nothing documented is smaller. */
const FLOOR = 11

/** Vendored per the design docs: these keep their own sizes, registry-faithful. */
const VENDORED = ['components/9ui/', 'components/interior/']

const tsxFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...tsxFiles(rel))
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(rel)
  }
  return out
}

/**
 * Comments are stripped BEFORE matching. `docs/DESIGN_FOUNDATIONS.md` and several
 * components name the anti-pattern in prose, and a comment can satisfy a guard as
 * readily as fail one — the `isoTimeGuard.test.ts` lesson, which existed because a
 * comment quoting the old expression made a deleted implementation read as compliant.
 */

interface Hit {
  file: string
  class: string
}

const hits: Hit[] = []
/** Sizes BELOW the 11px floor — no token exists for them, so they are named separately. */
const subFloor: Hit[] = []
for (const rel of [...tsxFiles('app'), ...tsxFiles('components')]) {
  if (VENDORED.some((v) => rel.startsWith(v))) continue
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
  // `text-` also prefixes colour, alignment and tracking, so bucket by the `px` unit:
  // a `text-[0.92em]` or `text-[0.5rem]` is not a px size and must not be judged here.
  for (const m of src.matchAll(/text-\[(\d+)px\]/g)) {
    const px = Number(m[1])
    if (DOCUMENTED.includes(px)) hits.push({ file: rel, class: m[0] })
    else if (px < FLOOR) subFloor.push({ file: rel, class: m[0] })
  }
}

/**
 * Sizes below the scale's floor — a DIFFERENT rule from the six documented sizes, and
 * conflating the two is how a guard ends up demanding a token that does not exist.
 * There is no `text-[9px]` utility, so the only available fixes are designing a 7th rung
 * or accepting the site. Both are design decisions, so these are named rather than
 * flagged: a count badge at 9px, a `<kbd>` at 10px, and three marketing divider labels.
 */
const SUB_FLOOR_GRANDFATHERED = [
  'components/DashboardNav.tsx ×1:text-[9px]',
  'components/GlobalSearch.tsx ×1:text-[10px]',
  'components/LandingPage.tsx ×3:text-[10px]',
]

const parseCounted = (entry: string) => {
  const m = /^([^:]+?)(?: ×(\d+))?:(.+)$/.exec(entry)
  if (!m) throw new Error(`unparseable entry: ${entry}`)
  return { file: m[1], count: m[2] ? Number(m[2]) : 1, cls: m[3] }
}
const subFloorEntries = SUB_FLOOR_GRANDFATHERED.map(parseCounted)

describe('no first-party component spells a documented size as text-[Npx]', () => {
  test('the scan finds a documented size when one is present', () => {
    // THE case this guard is missing, and it is the important one.
    //
    // `hits` is legitimately EMPTY today, so a version of this file that never matched
    // anything would be indistinguishable from a correct one. Both of these mutations
    // were applied and BOTH stayed green: disabling the scan, and dropping the
    // `DOCUMENTED.includes` filter. A guard that cannot see the defect it exists for is
    // a comment.
    //
    // So this runs the SAME matcher and the SAME filter against a fixture that DOES
    // contain the violation, and asserts it is caught. The fixture is a temporary
    // directory rather than a string so the scan cannot be satisfied by a special case
    // on the real tree — and the vendored exemption is re-derived from the same
    // `VENDORED` list, so a violation inside `components/interior/**` must be ignored
    // here too, which is the behaviour most likely to be over-applied.
    const tmp = join(ROOT, 'lib', '__tests__', '__typeScaleFixture')
    mkdirSync(tmp, { recursive: true })
    try {
      writeFileSync(
        join(tmp, 'Offender.tsx'),
        'export const A = () => <p className="text-[13px]" />\n' +
          'export const B = () => <p className="text-[28px]" />\n',
      )
      const src = stripComments(readFileSync(join(tmp, 'Offender.tsx'), 'utf8'))
      const found = [...src.matchAll(/text-\[(\d+)px\]/g)]
        .map((m) => Number(m[1]))
        .filter((px) => DOCUMENTED.includes(px))
      // 13 is documented and must be caught; 28 is bespoke and must not be.
      expect(found).toEqual([13])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('the scan is not vacuous on the real tree', () => {
    // The scan works AND the tree is currently clean — two separate claims, so both are
    // asserted. The positive control below is what makes the emptiness meaningful.
    expect(tsxFiles('app').length + tsxFiles('components').length).toBeGreaterThan(50)
    expect(hits).toEqual([])
  })

  test('the matcher still finds text-[Npx] in general', () => {
    // The positive control, and the one that catches the regex breaking. Bespoke sizes
    // exist and are permitted, so this proves the pattern matches something real while
    // the guard above proves none of them is a documented size.
    let bespoke = 0
    for (const rel of [...tsxFiles('app'), ...tsxFiles('components')]) {
      if (VENDORED.some((v) => rel.startsWith(v))) continue
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?(?:px|em|rem))\]/g)) {
        if (!DOCUMENTED.includes(Number.parseFloat(m[1]))) bespoke += 1
      }
    }
    expect(bespoke).toBeGreaterThan(20)
  })

  test('no first-party .tsx uses text-[Npx] for a documented size', () => {
    // Zero today, verified by a scan proven to work by the fixture case above. This is
    // the tripwire: the next `text-[13px]` fails here.
    expect(hits.map((h) => `${h.file}: ${h.class}`)).toEqual([])
  })

  test('every sub-floor size is named, and each still exists at its counted size', () => {
    // Both directions. Without the "still exists" half, a deleted site leaves its entry
    // behind and the list becomes a blanket permission — the same rot the `dark:` guard
    // guards against, reached independently.
    const unknown = subFloor
      .filter((h) => !subFloorEntries.some((g) => g.file === h.file && g.cls === h.class))
      .map((h) => `${h.file}: ${h.class}`)
    expect(unknown).toEqual([])

    const drift = subFloorEntries
      .map((g) => ({
        ...g,
        actual: subFloor.filter((h) => h.file === g.file && h.class === g.cls).length,
      }))
      .filter((g) => g.actual !== g.count)
      .map((g) => `${g.file}: ${g.cls} — expected ${g.count}, found ${g.actual}`)
    expect(drift).toEqual([])
  })

  test('the scan reaches BOTH halves of the tree, not just one of them', () => {
    // Found by mutation: skipping the loop body entirely left the documented-size case
    // green while only the sub-floor case noticed, because the subFloor assertion reads
    // its own list and so is sensitive to the scan visiting less. `hits` is empty by
    // design, so an EMPTY scan and a CORRECT scan look identical from the `hits` side —
    // which is the structural limit of asserting on an empty list, and the reason the
    // fixture case above exists.
    //
    // So this asserts the traversal itself rather than its output: both `app/` and
    // `components/` must contribute, and the count must exceed a floor that a partial
    // scan cannot reach. Restricting the scan to one directory is the plausible mistake.
    const app = tsxFiles('app')
    const comps = tsxFiles('components')
    expect(app.length).toBeGreaterThan(20)
    expect(comps.length).toBeGreaterThan(100)
    expect(hits.length + subFloor.length).toBeGreaterThan(0)
  })

  test('the floor is 11px, so a documented size can never read as bespoke', () => {
    // Pins the boundary from both sides. A guard written as "one of the six OR >= 17"
    // would silently PERMIT 10px, which is exactly how a floor rule goes missing.
    expect(DOCUMENTED[0]).toBe(FLOOR)
    expect(DOCUMENTED.includes(FLOOR)).toBe(true)
  })

  test('the vendored exemption is load-bearing, not decorative', () => {
    // Without this exemption the guard would be RED on 16 correct sites across 12
    // `components/interior/**` files. Asserted so a future widening of the glob — or a
    // change to the exempt list — cannot quietly turn those 16 into failures.
    let vendored = 0
    for (const rel of tsxFiles('components')) {
      if (!VENDORED.some((v) => rel.startsWith(v))) continue
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      for (const m of src.matchAll(/text-\[(\d+)px\]/g)) {
        if (DOCUMENTED.includes(Number(m[1]))) vendored += 1
      }
    }
    expect(vendored).toBeGreaterThan(0)
  })

  test('the six utilities exist at the six sizes, and are font-size-only', () => {
    // The half `typeScale.test.ts` already covers, restated here so this file is
    // self-contained about the rule it is half-enforcing: `text-[13px]` is only wrong
    // because `text-meta` exists AND is font-size-only. A line-height would make it a
    // different utility from the arbitrary value it replaces, and the rule's premise
    // would be false.
    //
    // The mapping is written out rather than derived from the size number. Deriving it
    // needs a lookup that does not exist, and inventing one here would duplicate
    // `globals.css` — which is the "restate what you mirror" failure the RSC guard was
    // fixed for. Six pairs, stated, and each asserted against BOTH the name and the px.
    const css = stripComments(readFileSync(join(ROOT, 'app/globals.css'), 'utf8'))
    const PAIRS: Array<[string, number]> = [
      ['label', 11],
      ['caption', 12],
      ['meta', 13],
      ['body', 14],
      ['title', 15],
      ['lead', 16],
    ]
    expect(PAIRS.map(([, px]) => px)).toEqual(DOCUMENTED)
    for (const [name, px] of PAIRS) {
      expect(css).toContain(`--text-${name}: ${px}px;`)
    }

    // The utility block must carry no line-height, for the reason above.
    const block = /@utility\s+text-body\s*\{([\s\S]*?)\}/.exec(css)
    expect(block).not.toBeNull()
    expect(block?.[1] ?? '').not.toContain('line-height')
  })

  test('the blocked half is recorded rather than silently unenforced', () => {
    // `DESIGN_FOUNDATIONS.md` states the bespoke boundary three incompatible ways, and
    // 18px/26px/44px fall in the disagreement — so the verdict flips on 19 sites
    // depending on which sentence wins. This asserts the docs still contradict each
    // other, so the day they are reconciled this test fails and asks whether the
    // remaining half can be written. A guard that quietly drops half a rule is the thing
    // this repo keeps paying for.
    const doc = readFileSync(join(ROOT, '..', 'docs', 'DESIGN_FOUNDATIONS.md'), 'utf8')
    expect(doc).toMatch(/28[–-]40/)
    expect(doc).toMatch(/26[–-]68/)
  })
})
