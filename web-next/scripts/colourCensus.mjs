#!/usr/bin/env node
// ── Colour census: enumerate every raw-colour site in web-next ──────────────────
//
// The single implementation behind the colour GUARD (`lib/__tests__/colourTokens.test.ts`),
// which imports the functions below — so the census and the guard cannot drift into two
// matchers that disagree, the way a hand-written list drifts from the thing it mirrors.
// Re-derive the numbers any time:
//
//     node scripts/colourCensus.mjs            # print
//     node scripts/colourCensus.mjs --check    # exit 1 if docs/colour-census.txt is stale
//
// Three distinct rules, deliberately NOT conflated (the gap AGENTS.md recorded: "no guard
// exists for hex, `dark:` pairs, or palette classes at all"):
//
//   rule 1 — raw hex literals inside a className or an inline `style` object
//            (context matters: a hex in a canvas `fillStyle` is neither, and
//            `components/VideoPlayer.tsx` paints exactly such theme-invariant ones)
//   rule 2 — `dark:` colour pairs, CLASSIFIED into the kinds the ledger established
//            (A literal-over-token, B literal-over-literal scrim — legitimate only
//            vendored, a first-party B is a violation since the scrim is `--overlay`,
//            C token→token, D same-token alpha shift, S sanctioned `none`), because
//            some kinds are legitimate and a rule that cannot tell them apart demands
//            deletions nobody asked for — while P/H/E/U/N kinds are hand-spelled values
//   rule 3 — Tailwind stock palette classes (`bg-red-500`), which bypass the token
//            system entirely
//
// Plus a BOUNDARY section: what is recorded but deliberately not guarded (hex outside
// presentation contexts, rgba in arbitrary shadows — no `--shadow-*` token exists).
//
// COMMENT DISCIPLINE: comments are MASKED (space-filled, offsets preserved) before any
// matching, so a comment QUOTING a banned pattern neither trips nor satisfies a check,
// and line numbers still point at the real source. `isoTimeGuard` lesson.
//
// EXEMPTIONS live here, not in the test file, because the census annotates exempt vs
// violation and the guard asserts both directions over the same list — one writer.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Vendored, registry-faithful — exempt from rules 2 and 3 BY PATH (rule 1 exempts by
 *  named site instead, so the recharts hexes in `9ui/ui/chart.tsx` are individually
 *  visible below rather than hidden behind a directory-wide pass). */
export const VENDORED = ['components/9ui/', 'components/interior/']

/**
 * Rule-1 exemptions, as `relative/path ×count:hex`. Both directions are asserted by the
 * guard: every exemption must still exist at its counted size (else the entry is deleted),
 * and every hex site the scan finds must be exempt (else it is a violation).
 *
 * These five are ATTRIBUTE-SELECTOR MATCH KEYS, not rendered colours: recharts hardcodes
 * `stroke='#ccc'` / `stroke='#fff'` on its default layers, and `[&_.recharts-grid_line[stroke='#ccc']]:stroke-border/50`
 * matches that attribute to RESTYLE the layer with the app's `border` token. The value a
 * user sees is the token; the hex only names recharts' default to override it. Vendored
 * `components/9ui/ui/chart.tsx` (shadcn chart primitive) ships them verbatim — editing it
 * would desync it from the registry it mirrors.
 */
export const HEX_EXEMPTIONS = [
  'components/9ui/ui/chart.tsx ×3:#ccc',
  'components/9ui/ui/chart.tsx ×2:#fff',
]

/** Parse a `file ×N:literal` exemption key. Anchored on `×N:` — `lastIndexOf(':')`
 *  would split INSIDE a value that itself contains a colon (the darkVariantTokens
 *  parseEntry lesson: the key is `file ×N:dark:…`, and the last colon is the wrong one). */
export const parseCounted = (entry) => {
  const m = /^([^:]+?)(?: ×(\d+))?:(.+)$/.exec(entry)
  if (!m) throw new Error(`unparseable exemption entry: ${entry}`)
  return { file: m[1], count: m[2] ? Number(m[2]) : 1, value: m[3] }
}

/**
 * Blank out comments while preserving LENGTH and newlines, so offsets → line numbers
 * stay valid for the original file. Semantics match `lib/__tests__/helpers/stripComments.ts`
 * (block comments; `//` unless preceded by `:` so URLs survive); the guard asserts the two
 * agree modulo whitespace, because two strippers that disagree would make the guard and
 * this census see different source.
 */
export const maskComments = (src) =>
  // ONE left-to-right pass, for the same reason stripComments uses one: a block opener
  // appearing inside a line comment must not open a phantom block that swallows real code.
  src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/gm, (m, p1) => {
    const head = p1 ?? ''
    return head + m.slice(head.length).replace(/[^\n]/g, ' ')
  })

// ── File walk ────────────────────────────────────────────────────────────────────

const SOURCE_FILE = /\.tsx?$/
const TEST_FILE = /\.test\.tsx?$/

/** Every scannable file under the three roots. `*.test.*` and `__tests__/` are test
 *  scaffolding — fixture files there CARRY violations on purpose (see
 *  `lib/__tests__/fixtures/tokenBypasses.tsx`), so scanning them would report the
 *  controls as real sites. Sorted for deterministic output. */
export const listSourceFiles = (root) => {
  const out = []
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(p)
      } else if (SOURCE_FILE.test(e.name) && !TEST_FILE.test(e.name)) out.push(p)
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(dir)
  out.sort()
  return out
}

export const isVendored = (rel) => VENDORED.some((v) => rel.startsWith(v))

// ── Theme tokens (app/globals.css) ──────────────────────────────────────────────

/**
 * Names the classifier can resolve: `bg-<name>` compiles only when `--color-<name>` is
 * declared, and an unknown token under `dark:` is a utility that emits NOTHING (a silent
 * no-style), so "not in here" is a finding, not a pass.
 */
export const readColorUtilityNames = (root) => {
  const css = maskComments(readFileSync(join(root, 'app', 'globals.css'), 'utf8'))
  const names = new Set()
  for (const m of css.matchAll(/--color-([\w-]+)\s*:/g)) names.add(m[1])
  return names
}

/** Every `--*` declaration in globals.css, for `var(--x)`-shaped arbitrary values. */
export const readDeclaredVars = (root) => {
  const css = maskComments(readFileSync(join(root, 'app', 'globals.css'), 'utf8'))
  const names = new Set()
  for (const m of css.matchAll(/--([\w-]+)\s*:/g)) names.add(m[1])
  return names
}

// ── Rule 1 — hex literals in className / inline style ───────────────────────────

/** 8/6/4/3-digit hex, longest first so `#ffffffff` is one match. Negative lookahead
 *  keeps `#12345g` (not hex) out and stops a 3-digit read of a 6-digit value. */
export const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g
/** rgb()/rgba()/hsl()/hsla() — reported in the BOUNDARY section (rule 1 is hex-scoped).
 *  NO `\b` before the name: in a Tailwind arbitrary value the function follows `_`
 *  (`shadow-[0_10px_30px_rgba(0,0,0,0.08)]`), and `_` is a word character, so a word
 *  boundary would miss exactly the sites this section exists to record. */
export const RGB_RE = /(?:rgba?|hsla?)\([^)]*\)/g

/**
 * Presentation contexts: `className=` / `class=` (object form `className:` included, the
 * form a `.ts` helper builds classes in) and `style=` / `style:` objects. A bare hex in a
 * string constant or a canvas `fillStyle` is NOT in scope — that is the boundary the
 * census records, and `VideoPlayer`'s seven canvas hexes sit outside it on purpose
 * (canvas cannot take `var()`; `VideoPlayer.colors.test.ts` pins them instead).
 */
const ATTR_RE = /\b(className|class|style)\s*[=:]/g

/** Skip a string literal starting at `i` (`'`, `"` or backtick, with escapes and
 *  backtick `${}` nesting). Returns the index of the closing quote. */
const skipString = (src, i) => {
  const q = src[i]
  const n = src.length
  if (q === '`') {
    let j = i + 1
    while (j < n) {
      if (src[j] === '\\') j += 2
      else if (src[j] === '$' && src[j + 1] === '{') {
        j = skipBraces(src, j + 1) + 1
      } else if (src[j] === '`') return j
      else j += 1
    }
    return n - 1
  }
  let j = i + 1
  while (j < n) {
    if (src[j] === '\\') j += 2
    else if (src[j] === q) return j
    else j += 1
  }
  return n - 1
}

/** Walk a `{…}` block starting AT the opening brace; returns its closing index. String-
 *  aware so a `}` inside a literal does not end the block early. */
const skipBraces = (src, i) => {
  let depth = 0
  let j = i
  for (; j < src.length; j += 1) {
    const ch = src[j]
    if (ch === "'" || ch === '"' || ch === '`') {
      j = skipString(src, j)
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return j
    }
  }
  return src.length - 1
}

/** The span of the value after an attribute's `=`/`:` — a quoted string, a template, a
 *  brace block, or (fallback) the rest of the line. An identifier value (`className={cls}`)
 *  yields no literal to scan, which is the documented gap: hex routed through a variable
 *  cannot be seen from source. */
const valueSpan = (src, start) => {
  let i = start
  while (i < src.length && (src[i] === ' ' || src[i] === '\n')) i += 1
  const c = src[i]
  if (c === "'" || c === '"' || c === '`') return [i, skipString(src, i)]
  if (c === '{') return [i, skipBraces(src, i)]
  let j = i
  let depth = 0
  while (j < src.length) {
    const ch = src[j]
    if (ch === "'" || ch === '"' || ch === '`') {
      j = skipString(src, j)
      j += 1
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1
    else if (ch === '\n' && depth <= 0) break
    j += 1
  }
  return [i, j]
}

/** Line number (1-based) for a char offset — computed from the MASKED source, whose
 *  offsets are identical to the original because masking only space-fills. */
const lineAt = (src, index) => src.slice(0, index).split('\n').length

/** Extract the text of every presentation value in a file: `[{kind, line, text}]`. */
export const presentationValues = (src) => {
  const masked = maskComments(src)
  const out = []
  for (const m of masked.matchAll(ATTR_RE)) {
    const [a, b] = valueSpan(masked, m.index + m[0].length)
    const kind = m[1] === 'style' ? 'style' : 'className'
    out.push({ kind, line: lineAt(masked, a), text: masked.slice(a, b + 1) })
  }
  return out
}

/** Rule 1 sites in one file: every hex inside a presentation value. */
export const hexSitesIn = (file, src) => {
  const out = []
  for (const v of presentationValues(src)) {
    for (const m of v.text.matchAll(HEX_RE)) {
      out.push({ file, line: v.line, hex: m[0], context: v.kind })
    }
  }
  return out
}

/** Hexes ANYWHERE in the file — minus the presentation ones = the boundary count. */
export const hexOutsideContextIn = (file, src) => {
  const masked = maskComments(src)
  const inContext = new Set(hexSitesIn(file, src).map((s) => s.line))
  const out = []
  for (const m of masked.matchAll(HEX_RE)) {
    const line = lineAt(masked, m.index)
    if (!inContext.has(line)) out.push({ file, line, hex: m[0] })
  }
  return out
}

// ── Rule 3 — Tailwind stock palette classes ─────────────────────────────────────

const PALETTE_COLORS =
  'slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const PALETTE_SHADES = '(?:50|100|200|300|400|500|600|700|800|900|950)'

/** The stock palette class shape, matched ANYWHERE in source (a class-shaped token in a
 *  string is still a class). Variant prefixes are irrelevant — `dark:hover:bg-red-500`
 *  contains `bg-red-500`. `\b` before the property stops `text-` matching inside another
 *  word; the optional `[lrtbxy]-` covers `border-l-red-500`. Semantic colour utilities
 *  (`bg-destructive`, `text-muted-foreground`, `chart-1`) are not palette and never match. */
export const PALETTE_RE = new RegExp(
  `\\b(?:bg|text|border|ring|from|via|to|divide|outline|decoration|fill|stroke|shadow|accent|caret|placeholder)-(?:[lrtbxy]-)?(?:${PALETTE_COLORS})-${PALETTE_SHADES}(?:/\\d+(?:\\.\\d+)?)?(?![\\w-])`,
  'g',
)

/** The VALUE half of a palette class (`dark:bg-red-500` → `red-500`), for classification. */
const PALETTE_VALUE_RE = new RegExp(
  `^(?:[lrtbxy]-)?(?:${PALETTE_COLORS})-${PALETTE_SHADES}(?:/\\d+(?:\\.\\d+)?)?$`,
)

/** Rule 3 sites in one file. */
export const paletteSitesIn = (file, src) => {
  const masked = maskComments(src)
  return [...masked.matchAll(PALETTE_RE)].map((m) => ({
    file,
    line: lineAt(masked, m.index),
    cls: m[0],
  }))
}

// ── Rule 2 — `dark:` colour pairs, classified ───────────────────────────────────

/** The house `dark:` class matcher, verbatim from `darkVariantTokens.test.ts` so both
 *  guards see the same sites: class-shaped only, so `{ dark: '.dark' }` object keys and
 *  `dark: 'Dark'` labels are excluded by construction. */
export const DARK_RE =
  /dark:((?:[a-z-]+:)*(?:[a-z]+)-(?:\[[^\]]*\]|[a-z0-9/\[\]._-]+))(?![a-z0-9/\[\]._-])/g

/** Colour properties a `dark:` pair can carry. `shadow` is here so `dark:shadow-none`
 *  is CLASSIFIED (sanctioned) rather than invisible; `tokenUsage.test.ts` owns whether a
 *  shadow pairs with it at all. */
const COLOUR_PROPS =
  'bg|text|border|ring|from|via|to|divide|outline|decoration|fill|stroke|shadow'

const isColourClass = (cls) => new RegExp(`^(?:${COLOUR_PROPS})-`).test(cls)

/** `primary/[0.09]` → `{ name: 'primary', alpha: 0.09 }`; `card` → alpha 1. */
const parseColourValue = (v) => {
  const m = /^([a-z][\w-]*)(?:\/(?:\[([0-9.]+)\]|(\d+(?:\.\d+)?)))?$/.exec(v)
  if (!m) return null
  const raw = m[2] ?? m[3]
  return { name: m[1], alpha: raw === undefined ? 1 : Number(raw) }
}

const isLiteralHue = (v) => /^(white|black)(?:\/|$)/.test(v)

/** Split a captured `dark:` class into its variant chain and the class proper:
 *  `hover:bg-muted/50` → `{ chain: 'hover:', cls: 'bg-muted/50' }`. */
const splitChain = (raw) => {
  const i = raw.lastIndexOf(':')
  return i === -1 ? { chain: '', cls: raw } : { chain: raw.slice(0, i + 1), cls: raw.slice(i + 1) }
}

/**
 * Classify one `dark:` colour pair. Returns one of:
 *
 *   legitimate by kind (first-party; vendored is path-exempt from rule 2 entirely) —
 *     S  sanctioned non-colour (`dark:shadow-none`)
 *     A  literal hue over a TOKEN base        (hand-spelled → remitted to the
 *                                              darkVariantTokens GRANDFATHERED table)
 *     C  token → different token / `transparent` (the token mechanism itself)
 *     D  same token, alpha shifted in dark  (blessed: `docs/DESIGN_FOUNDATIONS.md`)
 *     V  arbitrary value that resolves a declared `var(--x)`
 *   violations —
 *     B  literal hue over a literal base — legitimate ONLY as the vendored registry's
 *        scrim; a first-party pair is a hand-spelled scrim (use `bg-overlay`)
 *     P  stock palette value      H  hand literal (hex / rgb() …)
 *     E  dead variant (identical value both sides)
 *     U  unclassifiable (no base on the line to classify against — fail closed)
 *     N  unknown token (the utility would emit nothing)
 *
 * `U` matters more than it looks: without a base, "same token" and "token → token" are
 * both unprovable, and a pass would be a guess.
 */
export const classifyDarkPair = ({ cls: rawClass, lineText, colorNames, declaredVars }) => {
  const { chain, cls } = splitChain(rawClass)
  if (!isColourClass(cls)) return { kind: 'S', reason: 'non-colour property' }
  const hyphen = cls.indexOf('-')
  const prop = cls.slice(0, hyphen)
  const value = cls.slice(hyphen + 1)

  if (value === 'none') return { kind: 'S', reason: 'the sanctioned non-colour idiom' }
  if (/#|rgba?\(|hsla?\(/i.test(value)) return { kind: 'H', reason: 'hand-written colour literal' }
  if (PALETTE_VALUE_RE.test(value)) return { kind: 'P', reason: 'stock palette value' }

  // Base candidates: same variant chain, same property, same line — `dark:hover:bg-x` pairs
  // with `hover:bg-x`, not with a bare `bg-x`, and gradient prefixes (`bg-gradient-to-b`)
  // are a different property family. Tokens are split the way the measure script splits
  // them: on whitespace and quote/brace noise.
  // The light-half token IS the base even when it is byte-identical to the dark class
  // (`bg-card dark:bg-card`) — excluding it as a self-match would make the dead-variant
  // branch below unreachable and report the pair as unclassifiable instead. Identical
  // text is not "the matcher matching itself": it is exactly the evidence E needs.
  const tokens = lineText.split(/[\s"'`{}]+/).filter(Boolean)
  const base = tokens.filter(
    (t) => t.startsWith(`${chain}${prop}-`) && !t.startsWith('dark:') && !t.includes('gradient'),
  )

  if (isLiteralHue(value)) {
    // A vs B: the ledger's literal-over-token (kind A) vs the literal-over-literal scrim
    // (kind B). First-party kind A is remitted to darkVariantTokens' table by the guard;
    // first-party B no longer exists (the scrim is `--overlay` now) and `firstPartyViolations`
    // flags it if it reappears — only the vendored registry pair is tolerated.
    const baseLit = base.length === 1 && isLiteralHue(splitChain(base[0]).cls.replace(`${prop}-`, ''))
    return {
      kind: baseLit ? 'B' : 'A',
      reason: 'literal hue under dark:',
      base: base.length === 1 ? base[0] : null,
    }
  }

  if (value === 'transparent') {
    return base.length === 1
      ? { kind: 'C', reason: 'token → theme-invariant keyword', base: base[0] }
      : { kind: 'U', reason: 'no single base on the line to pair with' }
  }

  const arbitrary = /^\[var\(--([\w-]+)\)\]$/.exec(value)
  if (arbitrary) {
    return declaredVars.has(arbitrary[1])
      ? { kind: 'V', reason: 'arbitrary value resolving a declared var' }
      : { kind: 'N', reason: `var(--${arbitrary[1]}) is not declared in globals.css` }
  }

  const here = parseColourValue(value)
  if (!here) return { kind: 'N', reason: 'unparseable value' }
  if (!colorNames.has(here.name)) return { kind: 'N', reason: `unknown token ${here.name}` }

  if (base.length !== 1) {
    return {
      kind: 'U',
      reason: `expected exactly one ${chain}${prop}-* base on the line, found ${base.length}`,
    }
  }
  const baseVal = splitChain(base[0]).cls.slice(prop.length + 1)
  const there = parseColourValue(baseVal)
  if (!there || (!colorNames.has(there.name) && !isLiteralHue(baseVal))) {
    return { kind: 'U', reason: `unparseable base ${base[0]}` }
  }
  if (here.name !== there.name) return { kind: 'C', reason: 'token → different token', base: base[0] }
  if (here.alpha === there.alpha) {
    return { kind: 'E', reason: 'identical value on both sides (dead variant)', base: base[0] }
  }
  return { kind: 'D', reason: 'same token, alpha shifted in dark', base: base[0] }
}

/** Rule-2 sites in one file: every class-shaped `dark:` colour pair, classified. */
export const darkPairsIn = (file, src, colorNames, declaredVars) => {
  const masked = maskComments(src)
  const lines = masked.split('\n')
  const out = []
  for (const m of masked.matchAll(DARK_RE)) {
    const raw = m[1].trim()
    const { cls } = splitChain(raw)
    if (!isColourClass(cls)) continue // e.g. `dark:backdrop-blur` — not a colour pair
    const line = lineAt(masked, m.index)
    const classified = classifyDarkPair({
      cls: raw,
      lineText: lines[line - 1] ?? '',
      colorNames,
      declaredVars,
    })
    out.push({ file, line, literal: `dark:${raw}`, ...classified })
  }
  return out
}

/** First-party literal-hue colour classes NOT under `dark:` — boundary (rule 1 is hex,
 *  rule 2 is the dark half; the light half of these pairs is outside all three rules). */
export const NON_DARK_HUE_RE = new RegExp(
  `\\b(?:${COLOUR_PROPS})-(?:white|black)(?:/\\d+(?:\\.\\d+)?)?(?![\\w-])`,
  'g',
)
export const nonDarkLiteralHuesIn = (file, src) => {
  const masked = maskComments(src)
  return [...masked.matchAll(NON_DARK_HUE_RE)]
    // A lookbehind would exclude `dark:` but also `hover:`; filter on the token instead.
    .filter((m) => {
      const before = masked.slice(0, m.index)
      const tokenStart = before.search(/[\s"'`{}]([^\s"'`]*)$/)
      const token = (tokenStart === -1 ? before : before.slice(tokenStart + 1)) + m[0]
      return !token.startsWith('dark:')
    })
    .map((m) => ({ file, line: lineAt(masked, m.index), cls: m[0] }))
}

// ── Whole-tree scan ─────────────────────────────────────────────────────────────

/**
 * Enumerate everything the three rules see, plus the boundary. Deterministic ordering
 * (files sorted, sites sorted by line) so `formatCensus` output is byte-stable and can
 * be freshness-pinned against `docs/colour-census.txt`.
 */
export const scan = (root) => {
  const colorNames = readColorUtilityNames(root)
  const declaredVars = readDeclaredVars(root)
  const files = listSourceFiles(root).map((file) => ({
    file,
    src: maskComments(readFileSync(join(root, file), 'utf8')),
  }))
  const firstParty = files.filter((f) => !isVendored(f.file))
  const vendored = files.filter((f) => isVendored(f.file))

  const rule1First = firstParty.flatMap((f) => hexSitesIn(f.file, f.src))
  const rule1Vend = vendored.flatMap((f) => hexSitesIn(f.file, f.src))
  const rule2First = firstParty.flatMap((f) =>
    darkPairsIn(f.file, f.src, colorNames, declaredVars),
  )
  const rule2Vend = vendored.flatMap((f) => darkPairsIn(f.file, f.src, colorNames, declaredVars))
  const rule3First = firstParty.flatMap((f) => paletteSitesIn(f.file, f.src))
  const rule3Vend = vendored.flatMap((f) => paletteSitesIn(f.file, f.src))

  const exempted = HEX_EXEMPTIONS.map(parseCounted)
  const countHex = (sites, entry) =>
    sites.filter((s) => s.file === entry.file && s.hex === entry.value).length
  const rule1Unknown = rule1First.concat(rule1Vend).filter(
    (s) => !exempted.some((e) => e.file === s.file && e.value === s.hex),
  )

  return {
    colorUtilityCount: colorNames.size,
    files: {
      app: firstParty.filter((f) => f.file.startsWith('app/')).map((f) => f.file),
      components: firstParty
        .filter((f) => f.file.startsWith('components/'))
        .map((f) => f.file),
      lib: firstParty.filter((f) => f.file.startsWith('lib/')).map((f) => f.file),
      vendored: vendored.map((f) => f.file),
    },
    rule1: {
      firstParty: rule1First,
      vendored: rule1Vend,
      unknown: rule1Unknown,
      exempt: HEX_EXEMPTIONS.map((entry) => {
        const e = parseCounted(entry)
        return { ...e, found: countHex(rule1First.concat(rule1Vend), e) }
      }),
    },
    rule2: { firstParty: rule2First, vendored: rule2Vend },
    rule3: { firstParty: rule3First, vendored: rule3Vend },
    boundary: {
      hexOutsideContext: firstParty.flatMap((f) => hexOutsideContextIn(f.file, f.src)),
      rgbaInClass: firstParty
        .concat(vendored)
        .flatMap((f) =>
          presentationValues(f.src)
            .filter((v) => v.kind === 'className')
            .flatMap((v) =>
              [...v.text.matchAll(RGB_RE)].map((m) => ({
                file: f.file,
                line: v.line,
                fn: m[0].slice(0, m[0].indexOf('(')),
                vendored: isVendored(f.file),
              })),
            ),
        ),
      nonDarkHues: firstParty.flatMap((f) => nonDarkLiteralHuesIn(f.file, f.src)),
      vendoredHues: vendored.flatMap((f) => nonDarkLiteralHuesIn(f.file, f.src)),
    },
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────

const KIND_ORDER = ['A', 'B', 'C', 'D', 'S', 'V', 'P', 'H', 'E', 'U', 'N']
const KIND_LABEL = {
  A: 'literal hue over token (remitted to darkVariantTokens)',
  B: 'literal over literal (scrim pair; vendored registry exempt, first-party = violation)',
  C: 'token → token / transparent',
  D: 'same token, alpha shifted',
  S: 'sanctioned non-colour (none)',
  V: 'var()-backed arbitrary value',
  P: 'VIOLATION — stock palette value',
  H: 'VIOLATION — hand-written literal',
  E: 'VIOLATION — dead variant (identical both sides)',
  U: 'VIOLATION — unclassifiable (no base on the line)',
  N: 'VIOLATION — unknown token',
}
/**
 * First-party legitimate kinds. B is deliberately ABSENT: a literal-over-literal pair
 * is legitimate only as the vendored registry's scrim — the first-party copy of that
 * pair was tokenised to `--overlay` (darkVariantTokens' own test pins it), so a new
 * first-party B is a hand-spelled scrim and belongs in the violation list. Vendored
 * pairs never reach this function: `scan` partitions them by path first.
 */
const FIRST_PARTY_LEGIT = new Set(['A', 'C', 'D', 'S', 'V'])

/** Violating first-party pairs — exported so the guard and the report share ONE rule. */
export const firstPartyViolations = (pairs) => pairs.filter((p) => !FIRST_PARTY_LEGIT.has(p.kind))

const kindCounts = (pairs) => {
  const counts = Object.fromEntries(KIND_ORDER.map((k) => [k, 0]))
  for (const p of pairs) counts[p.kind] += 1
  return counts
}

/** Byte-stable text for `docs/colour-census.txt`. No timestamps, no absolute paths —
 *  the freshness test compares this string to the file, so anything varying would rot it. */
export const formatCensus = (r) => {
  const L = []
  const fpFiles = r.files.app.length + r.files.components.length + r.files.lib.length
  L.push('web-next colour census')
  L.push('re-derive: node scripts/colourCensus.mjs   (freshness pinned by lib/__tests__/colourTokens.test.ts)')
  L.push('')
  L.push('scope')
  L.push('  roots: app/, components/, lib/ — *.ts/*.tsx; *.test.* and __tests__/ excluded')
  L.push(`  first-party files: ${fpFiles} (app ${r.files.app.length}, components ${r.files.components.length}, lib ${r.files.lib.length})`)
  L.push(`  vendored path exemption: components/9ui/, components/interior/ — ${r.files.vendored.length} files`)
  L.push(`  colour utilities resolvable from @theme (--color-*): ${r.colorUtilityCount}`)
  L.push('')
  L.push('rule 1 — raw hex literals in className / inline style')
  L.push(`  first-party sites: ${r.rule1.firstParty.length}`)
  L.push(`  exempt sites: ${r.rule1.exempt.reduce((n, e) => n + e.found, 0)}`)
  for (const e of r.rule1.exempt) {
    L.push(
      `    ${e.file} ×${e.found} ${e.value} — recharts attribute-selector match key (vendored shadcn chart; the rendered value is a token)`,
    )
  }
  L.push(`  unexempted sites (violations): ${r.rule1.unknown.length}`)
  for (const s of r.rule1.unknown) L.push(`    ${s.file}:${s.line} ${s.hex} (${s.context})`)
  L.push('')
  L.push('rule 2 — dark: colour pairs, first-party (classified)')
  const c2 = kindCounts(r.rule2.firstParty)
  for (const k of KIND_ORDER) {
    if (c2[k] > 0) L.push(`  ${k} ${KIND_LABEL[k]}: ${c2[k]}`)
  }
  L.push(`  violations: ${firstPartyViolations(r.rule2.firstParty).length}`)
  for (const p of firstPartyViolations(r.rule2.firstParty)) {
    L.push(`    ${p.file}:${p.line} ${p.literal} — ${p.reason}`)
  }
  const c2v = kindCounts(r.rule2.vendored)
  L.push(`  vendored (path-exempt, rule 2): ${r.rule2.vendored.length} pairs`)
  for (const k of KIND_ORDER) {
    if (c2v[k] > 0) L.push(`    ${k} ${KIND_LABEL[k]}: ${c2v[k]}`)
  }
  L.push('')
  L.push('rule 3 — Tailwind stock palette classes')
  L.push(`  first-party sites: ${r.rule3.firstParty.length}`)
  for (const s of r.rule3.firstParty) L.push(`    ${s.file}:${s.line} ${s.cls}`)
  L.push(`  vendored sites: ${r.rule3.vendored.length} (path exemption present; unexercised for this rule unless shown above)`)
  for (const s of r.rule3.vendored) L.push(`    ${s.file}:${s.line} ${s.cls}`)
  L.push('')
  L.push('boundary — recorded, NOT guarded (outside the three rules)')
  const outside = new Map()
  for (const s of r.boundary.hexOutsideContext) {
    outside.set(s.file, (outside.get(s.file) ?? 0) + 1)
  }
  L.push(`  hex outside className/inline-style (first-party): ${outside.size === 0 ? 'none' : ''}`)
  for (const [file, n] of [...outside].sort()) {
    L.push(`    ${file} ×${n}`)
  }
  if (outside.has('components/VideoPlayer.tsx')) {
    L.push(
      "    (VideoPlayer paints to canvas, which cannot take var(): theme-invariant overlay scrims + getComputedStyle-resolved token fallbacks — components/VideoPlayer.colors.test.ts pins them)",
    )
  }
  for (const s of r.boundary.rgbaInClass) {
    L.push(
      `  ${s.fn}() in className: ${s.file}:${s.line}${s.vendored ? ' (vendored)' : ''} — arbitrary shadow colour; no --shadow-* token exists, paired with the sanctioned dark:shadow-none`,
    )
  }
  if (r.boundary.rgbaInClass.length === 0) L.push('  rgba/hsl in className: none')
  const hues = r.boundary.nonDarkHues
  L.push(
    `  literal white/black colour classes, non-dark, first-party: ${hues.length} — theme-invariant chrome (video overlays render on a black video surface in both themes)`,
  )
  for (const s of hues) L.push(`    ${s.file}:${s.line} ${s.cls}`)
  L.push(
    `  literal white/black colour classes, non-dark, vendored: ${r.boundary.vendoredHues.length} (registry scrim/chrome patterns)`,
  )
  L.push('')
  return `${L.join('\n')}\n`
}

// ── CLI ─────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(here, '..')
const CENSUS_PATH = join(WEB_ROOT, 'docs', 'colour-census.txt')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fresh = formatCensus(scan(WEB_ROOT))
  if (process.argv.includes('--check')) {
    let stored = ''
    try {
      stored = readFileSync(CENSUS_PATH, 'utf8')
    } catch {
      console.error(`FAIL  ${CENSUS_PATH} is missing — run: node scripts/colourCensus.mjs > docs/colour-census.txt`)
      process.exit(1)
    }
    if (stored !== fresh) {
      const a = stored.split('\n')
      const b = fresh.split('\n')
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i += 1
      console.error(`FAIL  docs/colour-census.txt is stale (first difference at line ${i + 1}):`)
      console.error(`  stored: ${a[i] ?? '<eof>'}`)
      console.error(`  fresh:  ${b[i] ?? '<eof>'}`)
      console.error('re-run: node scripts/colourCensus.mjs > docs/colour-census.txt')
      process.exit(1)
    }
    console.log('colour-census.txt is current')
  } else {
    process.stdout.write(fresh)
  }
}
