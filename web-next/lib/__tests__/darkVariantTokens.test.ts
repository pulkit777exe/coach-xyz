import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── A `dark:` variant that names a literal colour, instead of a token ──────────
//
// AGENTS.md: "never raw hex or hand-written `dark:` color pairs in `.tsx`; a
// theme-varying value is a token (add one value-exact)". This is the enforcement that
// did not exist — 26 live first-party sites sat on convention alone.
//
// WHY IT IS WRITABLE, having been written against a census rather than an opinion.
// An independent audit classified all 28 first-party class-shaped `dark:` sites and the
// only shape a "dark: + literal" rule can catch is 13 of them:
//
//   A. literal `white` against the `foreground` token  — 11 sites
//   B. literal `black` both sides (the scrim pair)      — 2 sites, since tokenised
//   C. token → DIFFERENT token                         — 2 sites  ← invisible here
//   D. same token, lower alpha in dark                  — 9 sites  ← blessed by docs
//   E. same token, IDENTICAL value (dead variant)       — 1 site   ← now removed
//   F. `dark:shadow-none`, a non-colour property        — 1 site   ← exempt by property
//
// C is the blind spot and it is deliberate: `bg-muted dark:bg-background` is a genuine
// theme-varying delta between two tokens, and a rule about LITERALS cannot see it. D is
// blessed: `docs/DESIGN_FOUNDATIONS.md` records that `primary` is identical in both
// themes, so `/10` and `/20` mods never shift. Both are recorded in AGENTS.md as known.
//
// FORBID, DON'T POLICE. Two of the 11 class-A sites change rendered pixels by 8/255
// when the delta is removed, and the scrim pair by 51/255 in light — so a rule that
// FORCED deletion would be a design decision dressed as a lint. This guard instead
// names the grandfathered sites, and asserts every member is still present, so the list
// cannot rot into a blanket permission by outliving what it permits.

// `lib/__tests__/` is TWO levels below the app root. Getting this wrong is silent:
// readdirSync then walks a directory that does not exist, or throws — and a guard whose
// scan found nothing passes every case below it.
const ROOT = join(import.meta.dirname, '..', '..')
if (!existsSync(join(ROOT, 'app'))) throw new Error(`bad ROOT: ${ROOT}`)

/** Vendored per the design docs: `9ui/**` and `interior/**` stay registry-faithful. */
const VENDORED = ['components/9ui/', 'components/interior/']

/**
 * The colour utilities a `dark:` variant may name. Scoped deliberately: `dark:shadow-none`
 * is the SANCTIONED dark idiom (`globals.css`: shadows don't read on dark), so a
 * whole-property rule would flag the idiom the docs require.
 */
const COLOUR_PREFIX_SRC =
  '^(bg|text|border|ring|from|via|to|divide|outline|decoration|fill|stroke|shadow)-'
/** Fresh regex per call: a `/g` literal is stateful and `.test()` would advance
 *  `lastIndex` between classes, so the second match could be missed. */
const isColourProperty = (cls: string) => new RegExp(COLOUR_PREFIX_SRC).test(cls)

/** `bg-white/8`, `divide-white/8`, `bg-black/45` — a literal hue Tailwind names. */
const isLiteralHue = (value: string) => /^(white|black)\b/.test(value)
/** The property prefix off a class, so `divide-white/8` can be tested as a hue. */
const hueOf = (cls: string) => cls.replace(new RegExp(COLOUR_PREFIX_SRC), '')

/**
 * The grandfathered sites, as `relative/path ×count:literal-class`. Two rules govern
 * this list: every member must still exist AT THE COUNTED SIZE (or the entry is
 * deleted), and the scan must still find more than the list contains (or the guard is
 * vacuous). Both are asserted below.
 *
 * The count is load-bearing, not decoration: `LandingPage.tsx` carries
 * `dark:bg-white/10` FOUR times, so a `file:literal` key cannot express the site at all
 * and a rottability check built on one reports every repeated entry as stale. Recording
 * the multiplicity also means that deleting ONE of the four fails the guard — which is
 * the point: the list should track the code, and half-deleting an entry is a change.
 */
const GRANDFATHERED = [
  // A — literal `white` over an already theme-flipping `--foreground`. Composited over
  // `--background` these are Δ1/255 (redundant), Δ4/255 (near-invisible) and Δ8/255
  // (visible) — hence listed rather than deleted.
  'app/login/page.tsx ×2:dark:bg-white/8',
  'app/pricing/page.tsx ×1:dark:divide-white/8',
  'components/LandingPage.tsx ×4:dark:bg-white/10',
  'components/LandingPage.tsx ×1:dark:bg-white/8',
  'components/LandingPage.tsx ×2:dark:divide-white/8',
  'components/LandingPage.tsx ×1:dark:border-white/10',
]

/**
 * Parse a grandfathered key back into its parts.
 *
 * Split on the COUNT marker, not on the last colon. `lastIndexOf(':')` looks obvious
 * and is wrong here: the key is `file ×N:dark:bg-white/8`, so the last colon is the one
 * inside `dark:` — the file came out as `…×2:dark` and the literal as `bg-white/8`,
 * which matches nothing. Anchoring on `×N:` is the only split that survives a literal
 * that itself contains a colon.
 */
const parseEntry = (entry: string) => {
  const m = /^([^:]+?)(?: ×(\d+))?:(.+)$/.exec(entry)
  if (!m) throw new Error(`unparseable grandfathered entry: ${entry}`)
  return { file: m[1], count: m[2] ? Number(m[2]) : 1, literal: m[3] }
}
const grandfathered = GRANDFATHERED.map(parseEntry)

/** Occurrence count of one literal class in one file. */
const countOf = (file: string, literal: string) =>
  sites.filter((s) => s.file === file && s.literal === literal).length

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const tsxFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...tsxFiles(rel))
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(rel)
  }
  return out
}

/** `dark:` must be followed by a class-shaped continuation, or it is an object key. */
const DARK_CLASS =
  /dark:((?:[a-z-]+:)*(?:[a-z]+)-(?:\[[^\]]*\]|[a-z0-9/\[\]._-]+))(?![a-z0-9/\[\]._-])/g

interface Site {
  file: string
  literal: string
}

const sites: Site[] = []
for (const rel of [...tsxFiles('app'), ...tsxFiles('components')]) {
  if (VENDORED.some((v) => rel.startsWith(v))) continue
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
  for (const m of src.matchAll(DARK_CLASS)) {
    // A className is space-separated, so trim: `dark:bg-white/8 ` must record as
    // `dark:bg-white/8` or the key never matches anything written by hand.
    const cls = m[1].trim()
    if (!isColourProperty(cls)) continue // e.g. dark:shadow-none
    if (!isLiteralHue(hueOf(cls))) continue
    sites.push({ file: rel, literal: `dark:${cls}` })
  }
}

describe('no new hand-written `dark:` literal colour pairs', () => {
  test('the scan finds the grandfathered sites, and is not vacuous', () => {
    // A guard whose regex stopped matching would pass every case below. Asserted on a
    // floor rather than on an exact count, because the count SHOULD fall as sites are
    // cleaned up — a floor is what stays true after that happens.
    expect(sites.length).toBeGreaterThanOrEqual(GRANDFATHERED.length)
    expect(sites.length).toBeLessThan(40)
  })

  test('every `dark:` + literal site is explicitly grandfathered', () => {
    // A new offender is named in full, so the failure says WHERE rather than a count.
    const unknown = sites
      .filter((s) => !grandfathered.some((g) => g.file === s.file && g.literal === s.literal))
      .map((s) => `${s.file}: ${s.literal}`)
    expect(unknown).toEqual([])
  })

  test('every grandfathered entry still exists at its counted size', () => {
    // The other direction, and the one that keeps the list honest. Without it, deleting
    // a site from the code would leave its entry behind and the list would quietly grow
    // into a blanket permission that passes any future offender. The count also catches
    // a PARTIAL cleanup, which a boolean entry would silently accept.
    const drift = grandfathered
      .map((g) => ({ ...g, actual: countOf(g.file, g.literal) }))
      .filter((g) => g.actual !== g.count)
      .map((g) => `${g.file}: ${g.literal} — expected ${g.count}, found ${g.actual}`)
    expect(drift).toEqual([])
  })

  test('the object-key false positives are excluded, not merely absent', () => {
    // `chart.tsx` has `{ light: '', dark: '.dark' }` and `PreferencesSection.tsx` has
    // `dark: 'Dark',` — data keys, not classes. A bare `dark:` substring rule fires on
    // both, so the class-shape requirement is load-bearing and this pins it.
    const chart = stripComments(readFileSync(join(ROOT, 'components/9ui/ui/chart.tsx'), 'utf8'))
    const prefs = stripComments(
      readFileSync(join(ROOT, 'components/org/PreferencesSection.tsx'), 'utf8'),
    )
    expect([...chart.matchAll(DARK_CLASS)].some((m) => isLiteralHue(m[1]))).toBe(false)
    expect(prefs).toContain("dark: 'Dark'")
    expect([...prefs.matchAll(DARK_CLASS)].some((m) => m[1].startsWith('-'))).toBe(false)
  })

  test('the sanctioned `dark:shadow-none` idiom is exempt by property', () => {
    // Five vendored sites plus HeaderClient use it, and it is what the docs REQUIRE —
    // `globals.css`: dark surfaces "live on low-opacity white borders (shadows don't read
    // on dark)". A whole-property rule would flag the idiom itself.
    //
    // Asserted as a FILTER, not as "the matcher never sees it": `dark:shadow-none` IS
    // captured (it is class-shaped, and `shadow-` is on the allowlist precisely so this
    // site is reachable), and it is then discarded because `none` is not a literal hue.
    // Asserting the matcher ignored it would pin the wrong mechanism, and would forbid a
    // future matcher that captures broadly and filters precisely — which is the better
    // shape. The meaningful claim is the end-to-end one: it does not appear in `sites`.
    const src = stripComments(readFileSync(join(ROOT, 'components/HeaderClient.tsx'), 'utf8'))
    expect(src).toContain('dark:shadow-none')
    expect([...src.matchAll(DARK_CLASS)].some((m) => m[1] === 'shadow-none')).toBe(true)
    expect(sites.some((s) => s.file === 'components/HeaderClient.tsx')).toBe(false)
  })

  test('the scrim is now a token, not a `dark:` pair', () => {
    // Shipped alongside this guard: `--overlay` is declared in `:root`, overridden in
    // `.dark`, and mapped in `@theme inline`. `rgb(0 0 0 / 0.45)` is byte-for-byte what
    // `bg-black/45` compiled to, so this changed no rendered pixel — it moved a
    // theme-varying alpha behind a token, which is the whole point.
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    expect(css).toContain('--overlay: rgb(0 0 0 / 0.45);')
    expect(css).toContain('--overlay: rgb(0 0 0 / 0.65);')
    // `inline` is load-bearing: it makes the utility reference `var(--overlay)` rather
    // than `var(--color-overlay)`, so it re-resolves against `.dark` at the element.
    expect(css).toMatch(/@theme inline[\s\S]*--color-overlay: var\(--overlay\)/)

    for (const rel of ['components/MobileNavDrawer.tsx', 'components/org/SettingsPanel.tsx']) {
      expect(readFileSync(join(ROOT, rel), 'utf8')).toContain('bg-overlay')
    }
  })

  test('the token-backed scrim utility actually resolves', () => {
    // Without `--color-overlay` in `@theme`, `bg-overlay` is an unknown utility and
    // Tailwind emits nothing — a scrim that silently disappears. Asserting the CSS text
    // is not enough on its own, so this checks the file the utility is derived from.
    const css = stripComments(readFileSync(join(ROOT, 'app/globals.css'), 'utf8'))
    // Read the BLOCKS, not the prose. `globals.css` literally contains the sentence
    // "never on `.root`", so a `/:root\s*\{/` regex matches a comment before it matches
    // the declaration — and stripping comments is what makes the block match unique.
    // `^` + `m` anchors the selector to column 0, which is how the file is formatted.
    const root = /^:root\s*\{([\s\S]*?)^\}/m.exec(css)
    const dark = /^\.dark\s*\{([\s\S]*?)^\}/m.exec(css)
    expect(root?.[1]).toContain('--overlay:')
    expect(dark?.[1]).toContain('--overlay:')
    // Both themes must declare it exactly once, or one theme inherits nothing and a
    // duplicate means a copy-paste landed in the wrong block.
    expect(root?.[1].match(/--overlay:/g)?.length).toBe(1)
    expect(dark?.[1].match(/--overlay:/g)?.length).toBe(1)
    // And the two alphas must differ, or the token is not actually theme-varying and
    // `bg-overlay` would be a slower spelling of `bg-black/45`.
    expect(root?.[1]).toContain('--overlay: rgb(0 0 0 / 0.45);')
    expect(dark?.[1]).toContain('--overlay: rgb(0 0 0 / 0.65);')
  })
})
