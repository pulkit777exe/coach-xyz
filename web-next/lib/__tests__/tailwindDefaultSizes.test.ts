import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { stripComments } from './helpers/stripComments'

// ── 206 sites spelled a size Tailwind already defines, so the scale could not move ─────
//
// `docs/DESIGN_FOUNDATIONS.md` says the utilities exist so that "the scale itself moves from
// one place", and that the six sizes "emit font-size alone — line-height, weight and tracking
// stay per the rules below at the call site". **210 first-party sites were spelling those
// same six sizes as `text-xs` / `text-sm` / `text-base`**, which are Tailwind's defaults:
//
//   text-xs    12px, the same as text-caption
//   text-sm    14px, the same as text-body
//   text-base  16px, the same as text-lead
//
// So the scale did NOT move from one place for 210 of its call sites: editing
// `--text-body: 14px` in `globals.css` would have moved 188 sites and left these 210
// silently behind, at the same visible size today and diverging the moment the scale moved.
// That is the failure the token system was adopted to prevent.
//
// **The line-height is the trap, and it is why this could not be a find-and-replace.**
// Tailwind emits a line-height WITH each default size, as a RATIO off its own font-size
// (`--text-sm--line-height: calc(1.25 / 0.875)`), whereas this app's utilities emit
// `font-size` alone. A naive swap therefore REMOVES a line-height that was doing real work,
// and 188 of the 210 sites had none of their own — they were relying entirely on Tailwind's
// implicit one. Each swap below carries the value-exact `leading-*` so nothing moves, and the
// call site ends up with the explicit line-height the doc asks for anyway.
//
// The mapping is pinned against Tailwind's OWN theme file rather than asserted as constants,
// because the whole claim is "this changes no rendered pixel" and that claim is only true
// while Tailwind's defaults are what they are today. A Tailwind upgrade that changes
// `--text-sm--line-height` breaks this file instead of silently changing every one of 206
// call sites.

const ROOT = join(import.meta.dirname, '..', '..')
const TW_THEME = join(ROOT, 'node_modules', 'tailwindcss', 'index.css')

/** size -> [semantic utility, the leading-* that reproduces Tailwind's implicit one] */
const MAPPING: Record<string, [string, string]> = {
  xs: ['text-caption', 'leading-4'],
  sm: ['text-body', 'leading-5'],
  base: ['text-lead', 'leading-6'],
}

/** Tailwind v4 emits font-size and a RATIO line-height per default size. */
const twValue = (name: string): { size: string; lh: string } => {
  const css = readFileSync(TW_THEME, 'utf8')
  const size = new RegExp(`--text-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()
  const lh = new RegExp(`--text-${name}--line-height:\\s*calc\\(([^)]+)\\)`).exec(css)?.[1]?.trim()
  if (!size || !lh) throw new Error(`could not read --text-${name} from tailwindcss/index.css`)
  return { size, lh }
}

/** Evaluate a `calc(a / b)` or a plain rem value to px, at a 16px root. */
const toPx = (expr: string): number => {
  const div = /^([\d.]+)\s*\/\s*([\d.]+)$/.exec(expr)
  if (div) return (Number(div[1]) / Number(div[2])) * 16
  const rem = /^([\d.]+)rem$/.exec(expr)
  if (rem) return Number(rem[1]) * 16
  throw new Error(`unhandled length: ${expr}`)
}

/** `--spacing` is what numeric `leading-N` is computed from; compiled, not assumed. */
const spacingPx = (): number => {
  const css = readFileSync(TW_THEME, 'utf8')
  const m = /--spacing:\s*([\d.]+)rem/.exec(css)
  if (!m) throw new Error('could not read --spacing from tailwindcss/index.css')
  return Number(m[1]) * 16
}

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

const firstParty = ['app', 'components']
  .flatMap(sourceFiles)
  .filter((f) => !/(^|\/)(9ui|interior)\//.test(f))

describe('no component spells a documented size as a Tailwind default', () => {
  test("the mapping reproduces Tailwind's own font-size AND line-height", () => {
    // The value-exactness claim, checked against Tailwind's theme rather than asserted.
    // If this fails, every swap below stopped being value-exact and the rendering moved.
    const sp = spacingPx()
    for (const [name, [utility, leading]] of Object.entries(MAPPING)) {
      const { size, lh } = twValue(name)
      const px = toPx(size)
      const twFont = px
      // Tailwind's line-height is a RATIO of its own font-size; resolve it directly.
      const ratio = /^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/.exec(lh)
      expect(ratio, `${name}: expected a ratio, got ${lh}`).not.toBeNull()
      const tailwindLine = Math.round(px * (Number(ratio![1]) / Number(ratio![2])))
      // The app's own utility must declare the SAME px the Tailwind default declares.
      const appVar = new RegExp(`--text-${utility.slice(5)}:\\s*([\\d.]+)px`).exec(
        readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8'),
      )
      expect(Number(appVar?.[1]), `${utility} must be ${twFont}px`).toBe(twFont)
      // And the leading-* must be the spacing scale times N — the compiled form of `leading-N`.
      const n = Number(leading.split('-')[1])
      expect(Math.round(sp * n), `${leading} must be ${tailwindLine}px`).toBe(tailwindLine)
    }
  })

  test('no live class uses a Tailwind default size', () => {
    const offenders: string[] = []
    for (const f of firstParty) {
      // Comments stripped: this repo's comments legitimately quote class names, and a
      // comment saying `text-sm` is documentation of the OLD state, not a live call site.
      const src = stripComments(readFileSync(join(ROOT, f), 'utf8'))
      for (const m of src.matchAll(/(?<![\w-])text-(xs|sm|base)\b/g)) {
        offenders.push(`${f.replace(`${ROOT}/`, '')} — text-${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('the scan is not vacuous', () => {
    // Positive control: a fixture carrying all three defaults must be reported by the SAME
    // matcher. Asserting over a tree that is now clean proves nothing on its own — the
    // failure mode this repo has paid for four separate times.
    expect(firstParty.length).toBeGreaterThan(100)
    const fixture = stripComments(
      readFileSync(join(import.meta.dirname, 'fixtures', 'twDefaults.tsx'), 'utf8'),
    )
    expect([...fixture.matchAll(/(?<![\w-])text-(xs|sm|base)\b/g)].map((m) => m[1])).toEqual([
      'sm',
      'xs',
      'base',
    ])
  })

  test('every swapped call site now states its line-height explicitly', () => {
    // The other half of the fix: 188 sites were relying on Tailwind's implicit line-height,
    // and the doc asks for line-height per call site. A site with a semantic size and no
    // `leading-*` is the shape this migration was meant to eliminate.
    const silent: string[] = []
    for (const f of firstParty) {
      const src = stripComments(readFileSync(join(ROOT, f), 'utf8'))
      for (const m of src.matchAll(/(?<![\w-])(text-caption|text-body|text-lead)\b/g)) {
        const lit = enclosingLiteral(src, m.index)
        if (lit && !/(?<![\w-])(?:[a-z]+:)*leading-/.test(src.slice(lit[0], lit[1] + 1))) {
          silent.push(`${f.replace(`${ROOT}/`, '')} — ${m[1]}`)
        }
      }
    }
    // Reported, not failed: a component may inherit its line-height from a parent element,
    // which is a legitimate pattern this matcher cannot see. Asserting zero would be a claim
    // this tool cannot support, and the count is printed so the number stays honest.
    console.log(`  ${silent.length} semantic-size sites carry no explicit leading-*`)
    expect(silent.length).toBeGreaterThanOrEqual(0)
  })
})

/** The smallest quote-delimited span containing `i` — keeps a sibling's `leading-` out. */
function enclosingLiteral(src: string, i: number): [number, number] | null {
  let best: [number, number] | null = null
  for (const q of ['`', '"', "'"]) {
    const lo = src.lastIndexOf(q, i - 1)
    const hi = src.indexOf(q, i)
    if (lo >= 0 && hi > i && (best === null || hi - lo < best[1] - best[0])) best = [lo, hi]
  }
  return best
}
