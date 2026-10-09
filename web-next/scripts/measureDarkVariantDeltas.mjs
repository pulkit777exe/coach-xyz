#!/usr/bin/env node
// ── Per-site measurement of the grandfathered `dark:` literal-hue sites ──────────
//
// Standalone tool, NOT a vitest test (the suite includes only `lib/`, `components/`
// and `app/`), so it carries zero suite risk and can be re-run any time:
//
//     node scripts/measureDarkVariantDeltas.mjs
//
// It answers the question the AGENTS.md ledger got wrong: for EACH site carrying a
// grandfathered `dark:bg-white/N`, how many /255 does the rendered pixel move if the
// variant is removed? The ledger recorded the four sites as "Δ 4, 6, 8 and 8"; this
// script derives the number per site from `globals.css` itself, in BOTH themes, and
// prints what it measured.
//
// METHOD (compositing). A utility class renders as `a·foreground + (1−a)·backdrop`
// per channel, where `a` is the token's own alpha times any `/N` modifier. The dark
// variant swaps the foreground colour and the alpha; the backdrop is whatever the
// element sits on. So:
//
//   Δ_dark  = |composite(base over backdrop) − composite(dark-variant over backdrop)|
//   Δ_light = 0, because a `dark:` variant CANNOT render in the light theme — the
//             variant is inert there, so removing it changes no pixel at all.
//
// The backdrop cannot be derived from the className alone (it is the parent's
// background), so the script reports Δ over every theme surface token as a range.
// That range is the honest answer, and it is tiny: Δ depends on the backdrop only
// through (a_base − a_variant) ≤ 0.02, so a 20/255 backdrop shift moves Δ by
// ≤ 0.4/255 — which is also why the rounded-to-integer verdict is stable.
//
// The site list is READ FROM THE GUARD (`darkVariantTokens.test.ts`'s GRANDFATHERED
// table), so the two cannot drift apart: this script measures exactly what the guard
// exempts, and exits non-zero if the guard's count, the code, or the census of
// first-party `dark:` literal sites disagree.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GUARD = join(ROOT, 'lib', '__tests__', 'darkVariantTokens.test.ts')

let failures = 0
const fail = (msg) => {
  failures += 1
  console.error(`FAIL  ${msg}`)
}

// Shared by every read below: a comment can satisfy a guard as readily as fail one
// (the `isoTimeGuard` lesson), so prose is stripped before any matching happens.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 1. The grandfathered table, read out of the guard ────────────────────────────

// Comments are stripped BEFORE the strings are pulled out: the table's own comment
// quotes classes in backticks (`bg-foreground/8`, `/9`, `dark:`), and matching
// backticks unstripped parses prose as entries — the isoTimeGuard lesson, again.
const guardSrc = stripComments(readFileSync(GUARD, 'utf8'))
const tableBlock = /const GRANDFATHERED = \[([\s\S]*?)\n\]/.exec(guardSrc)
if (!tableBlock) {
  fail('could not locate the GRANDFATHERED table in the guard')
  process.exit(1)
}
const entries = [...tableBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).map((entry) => {
  const p = /^([^:]+?)(?: ×(\d+))?:(.+)$/.exec(entry)
  if (!p) {
    fail(`unparseable grandfathered entry: ${entry}`)
    return null
  }
  return { entry, file: p[1], count: p[2] ? Number(p[2]) : 1, literal: p[3] }
}).filter(Boolean)
if (entries.length === 0) fail('the GRANDFATHERED table parsed to zero entries')

// ── 2. Theme tokens from globals.css ─────────────────────────────────────────────

const css = stripComments(readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8'))

const blockOf = (selector) => {
  const m = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(css)
  return m ? m[1] : null
}
const declarationsOf = (block, label) => {
  if (block === null) {
    fail(`could not read the ${label} block out of globals.css`)
    return {}
  }
  const out = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const lightTokens = declarationsOf(blockOf(':root'), ':root')
const darkTokens = declarationsOf(blockOf('\\.dark'), '.dark')
// Positive control: a parser that silently found nothing would render every Δ as 0.
for (const t of ['--foreground', '--background', '--border', '--muted']) {
  if (!(t in lightTokens)) fail(`light tokens missing ${t}`)
  if (!(t in darkTokens)) fail(`dark tokens missing ${t}`)
}

const resolveVar = (tokens, value, depth = 0) => {
  if (depth > 8) return null
  const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value)
  if (!m) return value
  return m[1] in tokens ? resolveVar(tokens, tokens[m[1]], depth + 1) : null
}

/** #rgb / #rrggbb / rgb(r,g,b) / rgb(r g b / a) → {r,g,b,a} (a in 0..1). */
const parseColor = (raw) => {
  if (!raw) return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw.trim())
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a,
    }
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(raw.trim())
  if (fn) {
    const parts = fn[1].split('/')[0].split(/[\s,]+/).filter(Boolean)
    const [r, g, b] = parts.slice(0, 3).map(Number)
    const a = parts[3] !== undefined ? Number(parts[3]) : 1
    if (![r, g, b, a].every(Number.isFinite)) return null
    return { r, g, b, a }
  }
  return null
}

const colorOfToken = (tokens, name) => {
  const value = resolveVar(tokens, tokens[name] ?? '')
  const c = parseColor(value)
  if (!c) fail(`could not parse token ${name} (${value ?? 'unset'})`)
  return c
}

/** `bg-foreground/8` → { token: '--foreground', mod: 0.08 }. */
const classColor = (tokens, cls) => {
  const m = /^bg-((?:--)?[\w-]+)(?:\/(\d+(?:\.\d+)?))?$/.exec(cls)
  if (!m) {
    fail(`unparseable colour class: ${cls}`)
    return null
  }
  const mod = m[2] !== undefined ? Number(m[2]) / 100 : 1
  // Tailwind's `white`/`black` are built-ins, not CSS custom properties — there is no
  // `--white` in globals.css, and resolving one as a token is how a correct parser
  // reports "could not parse" on every `dark:bg-white/N` site it exists to measure.
  const literal = { white: { r: 255, g: 255, b: 255, a: 1 }, black: { r: 0, g: 0, b: 0, a: 1 } }[m[1]]
  if (literal) return { ...literal, a: literal.a * mod }
  const token = m[1].startsWith('--') ? m[1] : `--${m[1]}`
  const base = colorOfToken(tokens, token)
  if (!base) return null
  return { r: base.r, g: base.g, b: base.b, a: base.a * mod }
}

/** a·fg + (1−a)·bd per channel. */
const over = (fg, bd) => ({
  r: fg.a * fg.r + (1 - fg.a) * bd.r,
  g: fg.a * fg.g + (1 - fg.a) * bd.g,
  b: fg.a * fg.b + (1 - fg.a) * bd.b,
})

const maxChannelDelta = (x, y) =>
  Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))

// ── 3. Locate each site, and the base class it replaces ──────────────────────────

const sites = []
for (const e of entries) {
  const src = readFileSync(join(ROOT, e.file), 'utf8')
  const lines = src.split('\n')
  const found = []
  lines.forEach((line, i) => {
    if (line.includes(e.literal)) found.push({ line: i + 1, text: line })
  })
  if (found.length !== e.count) {
    fail(`${e.file}: guard says ${e.count} × ${e.literal}, found ${found.length}`)
  }
  for (const hit of found) {
    const tokens = hit.text.split(/[\s"'`{}]+/).filter(Boolean)
    const prop = e.literal.slice('dark:'.length).split('-')[0] // 'bg'
    const bases = tokens.filter(
      (t) => t.startsWith(`${prop}-`) && !t.startsWith('dark:') && !t.includes('gradient'),
    )
    if (bases.length !== 1) {
      fail(
        `${e.file}:${hit.line} — expected exactly one base class beside ${e.literal}, ` +
          `found [${bases.join(', ')}]; measure by hand rather than trust a guess`,
      )
      continue
    }
    sites.push({ file: e.file, line: hit.line, literal: e.literal, base: bases[0] })
  }
}

// ── 4. Completeness: the census must equal the table, or a site is unmeasured ────

const VENDORED = ['components/9ui/', 'components/interior/']
const DARK_CLASS =
  /dark:((?:[a-z-]+:)*(?:[a-z]+)-(?:\[[^\]]*\]|[a-z0-9/\[\]._-]+))(?![a-z0-9/\[\]._-])/g
const COLOUR_PREFIX = /^(bg|text|border|ring|from|via|to|divide|outline|decoration|fill|stroke|shadow)-/
const tsxFiles = (dir) => {
  const out = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...tsxFiles(rel))
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(rel)
  }
  return out
}
const census = []
for (const rel of [...tsxFiles('app'), ...tsxFiles('components')]) {
  if (VENDORED.some((v) => rel.startsWith(v))) continue
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
  for (const m of src.matchAll(DARK_CLASS)) {
    const cls = m[1].trim()
    if (!COLOUR_PREFIX.test(cls)) continue
    if (!/^(white|black)\b/.test(cls.replace(COLOUR_PREFIX, ''))) continue
    census.push(`dark:${cls}`)
  }
}
const measured = sites.map((s) => s.literal)
const unmeasured = [...new Set(census)].filter((c) => !measured.includes(c))
const absent = [...new Set(measured)].filter((m) => !census.includes(m))
if (unmeasured.length) fail(`first-party dark: literal sites NOT in the table: ${unmeasured.join(', ')}`)
if (absent.length) fail(`tabled sites no longer present anywhere: ${absent.join(', ')}`)

// ── 5. Measure ───────────────────────────────────────────────────────────────────

const SURFACES = ['--background', '--card', '--muted', '--accent', '--secondary', '--popover']
const rows = []
for (const site of sites) {
  const variantColor = classColor(darkTokens, site.literal.slice('dark:'.length))
  if (!variantColor) continue
  const results = {}
  for (const theme of ['light', 'dark']) {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    const base = classColor(tokens, site.base)
    if (!base) continue
    // Backdrops are surfaces the element sits ON, and some surface tokens are
    // themselves translucent (`--accent: rgba(255,255,255,0.08)` in dark). Feeding a
    // raw translucent token in as an opaque backdrop would use 255 as the backdrop
    // value and understate Δ — so each surface is first composited over
    // `--background`, which is how the browser would actually render it.
    const page = colorOfToken(tokens, '--background')
    const backdrops = SURFACES.map((s) => colorOfToken(tokens, s))
      .filter(Boolean)
      .map((c) => (c.a >= 1 || !page ? c : over(c, page)))
    if (!backdrops.length) {
      fail(`no surface tokens found for the ${theme} theme`)
      continue
    }
    // The `dark:` variant is inert in the light theme: removing it cannot move a pixel.
    const deltas =
      theme === 'light'
        ? [0]
        : backdrops.map((bd) => maxChannelDelta(over(base, bd), over(variantColor, bd)))
    // The DISPLAYED delta over the page background: round each composite to an 8-bit
    // value, then subtract. Rounding the difference instead can disagree with this by
    // 1 (a raw 1.57 renders as 42 vs 43 — a displayed Δ1), which is the language the
    // ledger's "renders the same value twice" claim is written in.
    const baseShown = over(base, page ?? backdrops[0])
    const variantShown = theme === 'light' ? baseShown : over(variantColor, page ?? backdrops[0])
    results[theme] = {
      min: Math.min(...deltas),
      max: Math.max(...deltas),
      shown: Math.max(
        Math.abs(Math.round(baseShown.r) - Math.round(variantShown.r)),
        Math.abs(Math.round(baseShown.g) - Math.round(variantShown.g)),
        Math.abs(Math.round(baseShown.b) - Math.round(variantShown.b)),
      ),
      baseSample: over(base, backdrops[0]),
      variantSample: over(variantColor, backdrops[0]),
    }
  }
  rows.push({ ...site, ...results })
}

// ── 6. Report ────────────────────────────────────────────────────────────────────

const fmt = (n) => n.toFixed(2).padStart(6)
console.log('Per-site delta: rendered-pixel movement if the `dark:` variant is removed')
console.log('(max over R/G/B; range is across the theme surface tokens, light is inert)\n')
console.log('site                                   base class          dark Δ /255        light Δ')
console.log('─'.repeat(94))
for (const r of rows) {
  const name = `${r.file.replace('components/', '')}:${r.line}`.padEnd(38)
  const dark =
    r.dark && r.dark.min === r.dark.max
      ? `${fmt(r.dark.max)}        `
      : `${fmt(r.dark.min)}–${fmt(r.dark.max)}`
  const shown = r.dark ? `  shown ${String(r.dark.shown).padStart(2)}` : '  shown n/a'
  const light = r.light ? `${fmt(r.light.max)}  (inert)` : '   n/a'
  console.log(`${name}${r.base.padEnd(20)}${dark}${shown}   ${light}`)
}
console.log('─'.repeat(94))
const rounded = rows.map((r) => (r.dark ? Math.round(r.dark.max) : NaN))
console.log(`sites measured: ${rows.length}   rounded Δ (dark): ${rounded.join(', ')}`)
console.log(
  'light Δ is 0 by construction — a `dark:` variant cannot render in the light theme.',
)

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
