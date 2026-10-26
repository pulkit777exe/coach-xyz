import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { stripComments } from './helpers/stripComments'
import {
  DARK_RE,
  HEX_EXEMPTIONS,
  HEX_RE,
  darkPairsIn,
  firstPartyViolations,
  formatCensus,
  hexSitesIn,
  listSourceFiles,
  maskComments,
  paletteSitesIn,
  parseCounted,
  readColorUtilityNames,
  readDeclaredVars,
  scan,
} from '../../scripts/colourCensus.mjs'

// ── Three colour rules, one implementation, written against a census ────────────
//
// AGENTS.md recorded the gap for rounds: "no guard exists for hex, `dark:` pairs, or
// palette classes at all" — first-party colour was held by convention only. This file
// is the guard; `scripts/colourCensus.mjs` is the census, and the guard IMPORTS it, so
// the two cannot drift into separate matchers that disagree (the hand-written-list
// failure this repo keeps paying for). Re-derive the saved numbers any time:
//
//     node scripts/colourCensus.mjs            # print
//     node scripts/colourCensus.mjs --check    # fail if docs/colour-census.txt is stale
//
// THREE RULES, deliberately NOT conflated, because the correct verdict differs:
//
//   1. raw hex inside a className or an inline `style` — a hex is never a token.
//   2. `dark:` colour pairs, CLASSIFIED into the kinds the ledger established — some
//      kinds are legitimate (token→token, same-token alpha shift, sanctioned
//      `dark:shadow-none`), and a rule that cannot tell them apart demands deletions
//      nobody asked for.
//   3. Tailwind stock palette classes (`bg-red-500`) — not literally hex, but they
//      bypass the token system entirely.
//
// THE TREE IS CLEAN UNDER ALL THREE TODAY: 0 first-party hex sites, 0 first-party
// violations among 19 classified `dark:` pairs, 0 palette classes. That is exactly
// why the positive controls below are the load-bearing half — a guard over an empty
// result set cannot tell a correct tree from a broken scan, and this repo has shipped
// that defect repeatedly (typeScaleComponents' `hits`, the type-scale scan, the
// date-guard scan). Every rule therefore has a fixture that MUST be caught, run
// through the very functions the real-tree assertions call.
//
// EXEMPTIONS, each stated with its mechanism rather than as a bare name:
//   • vendored BY PATH (rules 2 and 3): `components/9ui/**`, `components/interior/**`
//     stay registry-faithful (DESIGN_FOUNDATIONS.md).
//   • hex BY NAMED SITE (rule 1): `9ui/ui/chart.tsx` carries ×3 `#ccc` + ×2 `#fff`
//     as attribute-selector MATCH KEYS — recharts hardcodes those defaults and
//     `[&_.recharts-grid_line[stroke='#ccc']]:stroke-border/50` restyles the layer WITH
//     A TOKEN, so what renders is a token and the hex only names recharts' default.
//     Keyed on `file:hex`, not on a path, so the exemption cannot silently widen to
//     every hex anywhere in the vendored tree; both directions are asserted.
//   • BOUNDARY (recorded in the census, deliberately NOT guarded here): hex outside
//     presentation contexts (VideoPlayer's 7 canvas hexes — canvas cannot take var() —
//     pinned by VideoPlayer.colors.test.ts), `rgba()` in arbitrary shadows (no
//     `--shadow-*` token exists; inventing one would be a design decision), and
//     non-dark literal `bg-white`/`text-white` chrome (video overlays that render over
//     a black video surface in both themes).
//
// COMMENTS ARE MASKED (space-filled, newlines and offsets preserved) before every
// match, so a comment QUOTING a banned pattern neither trips nor satisfies a check —
// the `isoTimeGuard` lesson. `HeaderClient.tsx` quotes `dark:shadow-none` in prose on
// two comment lines and carries it in code on a third; the masking test proves the
// matcher sees only the code line, with a raw-match control proving the comments are
// where the difference comes from.

// `lib/__tests__/` is TWO levels below the app root. Getting this wrong is silent:
// the walk then reports nothing and every "clean tree" assertion below passes.
const ROOT = join(import.meta.dirname, '..', '..')
if (!existsSync(join(ROOT, 'app'))) throw new Error(`bad ROOT: ${ROOT}`)

/** One scan of the real tree, shared by every real-tree assertion in this file. */
const RESULT = scan(ROOT)
/** Theme tokens from the SSOT (`app/globals.css`) — what the classifier resolves. */
const COLOR_NAMES = readColorUtilityNames(ROOT)
const DECLARED_VARS = readDeclaredVars(ROOT)

const siteKeys = (sites: Array<{ file: string; line: number; hex?: string; cls?: string }>) =>
  sites.map((s) => `${s.file}:${s.line} ${s.hex ?? s.cls ?? ''}`.trim())

const kindTally = (pairs: Array<{ kind: string }>) => {
  const counts = new Map<string, number>()
  for (const p of pairs) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
  return counts
}

describe('rule 1 — no raw hex in a first-party className or inline style', () => {
  test('a hex in a presentation value is caught, in every spelling the tree uses', () => {
    // The positive control. `hits`-style guards in this repo stayed green against a
    // matcher that matched nothing; this runs the SAME function the real-tree
    // assertion runs, over fixtures for each context rule 1 claims to cover:
    // a quoted className, an expression `className={cn(…)}` (the value span must walk
    // braces, not just quotes), a MULTILINE inline style object, the object-form
    // `className:` a .ts helper uses, and a lowercase HTML `class` attribute.
    const src = [
      'export const A = () => <p className="bg-[#123456]" />',
      '',
      'export const B = ({ x }: { x: boolean }) => (',
      "  <p className={cn('text-[#abcdef]', x ? 'border-[#fedcba]' : '')} />",
      ')',
      'const styles: CSSProperties = {',
      '  style: {',
      "    color: '#00ff00',",
      '  },',
      '}',
      "const row = { className: 'bg-[#000000]' }",
      'export const C = () => <div class="fill-[#123412]" />',
    ].join('\n')
    const sites = hexSitesIn('fixture/Fixture.tsx', src)
    // Line numbers are part of the claim: the multiline style's hex records on the
    // line of `style: {` (where the presentation value STARTS), not on the line of
    // the colour — that is how the census points a reader at a site.
    expect(siteKeys(sites)).toEqual([
      'fixture/Fixture.tsx:1 #123456',
      'fixture/Fixture.tsx:4 #abcdef',
      'fixture/Fixture.tsx:4 #fedcba',
      'fixture/Fixture.tsx:7 #00ff00',
      'fixture/Fixture.tsx:11 #000000',
      'fixture/Fixture.tsx:12 #123412',
    ])
    expect(sites.filter((s) => s.context === 'style').length).toBe(1)
    expect(sites.filter((s) => s.context === 'className').length).toBe(5)
  })

  test('hexes outside presentation contexts are NOT caught — and say which mechanism', () => {
    // The boundary, pinned from the other side. `VideoPlayer.tsx` paints theme-invariant
    // hexes to a CANVAS (which cannot take `var()`), so a rule that matched every hex
    // would demand a fix that cannot exist. Each exclusion here is a different
    // mechanism, so all three are separated by counting at each stage:
    //   raw source            → 4 hexes exist
    //   after comment masking  → 2 remain (the comment-quoted ones are masked out)
    //   after the context rule → 0 remain (the two survivors are code, not class/style)
    const src = [
      "const FILL = '#123456'",
      "ctx.fillStyle = '#654321'",
      '// className="bg-[#888888]"',
      '/* style={{ color: "#999999" }} */',
    ].join('\n')
    expect([...src.matchAll(HEX_RE)].length).toBe(4)
    expect([...maskComments(src).matchAll(HEX_RE)].length).toBe(2)
    expect(hexSitesIn('fixture/Canvas.tsx', src)).toEqual([])
  })

  test('the real first-party tree has zero hex sites, and the walk reached all of it', () => {
    // The tripwire, and separately the traversal floors — because "zero" from a scan
    // that read one directory looks identical to a clean tree. Floors are well below
    // the real counts (app 50, components 76 first-party, lib 36, vendored 31) so the
    // assertion survives ordinary file churn but cannot pass on a partial walk.
    expect(RESULT.rule1.firstParty).toEqual([])
    expect(RESULT.files.app.length).toBeGreaterThan(40)
    expect(RESULT.files.components.length).toBeGreaterThan(60)
    expect(RESULT.files.lib.length).toBeGreaterThan(20)
    expect(RESULT.files.vendored.length).toBeGreaterThan(20)
    const all = [
      ...RESULT.files.app,
      ...RESULT.files.components,
      ...RESULT.files.lib,
      ...RESULT.files.vendored,
    ]
    expect(all.length).toBeGreaterThan(150)
    // Test scaffolding must never be scanned: fixture files under `__tests__/` and
    // `*.test.*` carry violations ON PURPOSE (this file's own fixtures, and
    // `fixtures/tokenBypasses.tsx`), so counting them would report controls as sites.
    expect(all.filter((f) => f.includes('__tests__') || /\.test\./.test(f))).toEqual([])
  })

  test('every rule-1 exemption exists at its counted size, and nothing else is exempt', () => {
    // Both directions, the rot pattern this repo pins for every exemption list.
    //   exemption → tree: each entry still exists at its counted size, else the entry
    //                is stale and the list is silently widening into a blanket pass;
    //   tree → exemption: every hex site the scan finds is named, else it is a
    //                violation nobody signed off on.
    expect(HEX_EXEMPTIONS).toHaveLength(2)
    const entries = HEX_EXEMPTIONS.map(parseCounted)
    expect([...new Set(entries.map((e) => e.file))]).toEqual(['components/9ui/ui/chart.tsx'])
    const drift = RESULT.rule1.exempt
      .filter((e) => e.found !== e.count)
      .map((e) => `${e.file} ${e.value}: exemption says ${e.count}, scan found ${e.found}`)
    expect(drift).toEqual([])
    expect(RESULT.rule1.exempt.reduce((n, e) => n + e.found, 0)).toBe(5)
    // Unexempted = violations: first-party AND vendored (rule 1 exempts by named site,
    // never by path — a hex in any other vendored file is still a finding).
    expect(RESULT.rule1.unknown).toEqual([])
  })

  test('the chart.tsx exemption is still justified by its mechanism', () => {
    // An exemption justified by a mechanism must assert the mechanism (the `cn` /
    // twMerge lesson from tokenUsage). These five hexes are attribute-selector match
    // keys that RESTYLE recharts' hardcoded defaults with tokens — if the selectors
    // stop naming recharts' defaults, or stop resolving to a token, the exemption is
    // a stale name covering a real raw colour.
    const chart = readFileSync(join(ROOT, 'components/9ui/ui/chart.tsx'), 'utf8')
    expect(chart.match(/stroke='#ccc'/g)?.length).toBe(3)
    expect(chart.match(/stroke='#fff'/g)?.length).toBe(2)
    expect(chart).toContain("[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50")
    expect(chart).toContain("[&_.recharts-dot[stroke='#fff']]:stroke-transparent")
    // And the scan's findings are exactly those values in exactly that file.
    expect(RESULT.rule1.vendored).toHaveLength(5)
    for (const s of RESULT.rule1.vendored) {
      expect(s.file).toBe('components/9ui/ui/chart.tsx')
      expect(['#ccc', '#fff']).toContain(s.hex)
    }
  })
})

describe('rule 2 — every first-party dark: colour pair is classified and legitimate', () => {
  test('each kind classifies as itself, against the real globals.css tokens', () => {
    // The classifier's full matrix, run through `darkPairsIn` (the same entry point
    // the tree scan uses), resolving names against the REAL `app/globals.css` — a
    // stubbed token set would let every unknown-name branch lie. Legitimate kinds
    // A/C/D/S/V must be told apart from violating kinds P/H/E/U/N, and B must be
    // classified at all (it is a violation first-party, legitimate vendored).
    const KIND_MATRIX: Array<[string, string]> = [
      ['bg-foreground/8 dark:bg-white/10', 'A'],
      ['bg-black/45 dark:bg-black/65', 'B'],
      ['bg-muted dark:bg-background', 'C'],
      ['bg-primary/10 dark:bg-primary/20', 'D'],
      ['shadow-md dark:shadow-none', 'S'],
      ['bg-muted dark:bg-[var(--overlay)]', 'V'],
      ['bg-muted dark:bg-red-500', 'P'],
      ['bg-muted dark:bg-[#123456]', 'H'],
      ['bg-card dark:bg-card', 'E'],
      ['dark:bg-primary/10', 'U'],
      ['bg-muted dark:bg-notatoken', 'N'],
      ['hover:bg-muted/50 dark:hover:bg-background', 'C'],
    ]
    const src = KIND_MATRIX.map(([cls]) => `    <span className="${cls}" />`).join('\n')
    const pairs = darkPairsIn('fixture/Kinds.tsx', src, COLOR_NAMES, DECLARED_VARS)
    const expected = Object.fromEntries(
      KIND_MATRIX.map(([cls, kind]) => [`dark:${cls.slice(cls.indexOf('dark:') + 5)}`, kind]),
    )
    const actual = Object.fromEntries(pairs.map((p) => [p.literal, p.kind]))
    expect(actual).toEqual(expected)
    // Exactly one pair per fixture line: a matcher that fired twice, or swallowed a
    // line, would still satisfy an object comparison only by luck of key collapse.
    expect(pairs.length).toBe(KIND_MATRIX.length)
  })

  test('non-colour `dark:` classes are not colour pairs at all', () => {
    // `dark:opacity-50` and `dark:translate-y-1` are class-shaped and match DARK_RE;
    // they are excluded because they carry no colour to classify. The kind matrix
    // above is what proves `darkPairsIn` does see colour pairs on the same shape.
    const src = '<p className="dark:opacity-50 dark:translate-y-1 text-foreground" />'
    expect(darkPairsIn('fixture/NonColour.tsx', src, COLOR_NAMES, DECLARED_VARS)).toEqual([])
  })

  test('the real first-party tree has zero violating dark: pairs', () => {
    // The tripwire: a new `dark:bg-red-500` (P), a hand hex (H), a dead variant (E),
    // an unpairable line (U) or a first-party hand-spelled scrim (B) fails here, named
    // with file, line, literal and the classifier's own reason.
    // Annotated because the census is a .mjs and its return is `any`, which makes the
    // callback parameter implicitly `any` under noImplicitAny — the shape is the one
    // `firstPartyViolations` actually produces.
    const bad: Array<{
      file: string
      line: number
      literal: string
      kind: string
      reason: string
    }> = firstPartyViolations(RESULT.rule2.firstParty)
    expect(bad.map((p) => `${p.file}:${p.line} ${p.literal} [${p.kind}] ${p.reason}`)).toEqual([])
  })

  test('the classified tree is not vacuous, and the legitimate kinds are represented', () => {
    // Zero violations is only meaningful over a scan that classified something. Floors
    // (not exact counts) for the legitimate kinds, so cleanup does not break the guard
    // while a scan that stopped classifying cannot pass.
    const first = RESULT.rule2.firstParty
    expect(first.length).toBeGreaterThanOrEqual(15)
    const counts = kindTally(first)
    expect(counts.get('A') ?? 0).toBeGreaterThanOrEqual(4)
    expect(counts.get('C') ?? 0).toBeGreaterThanOrEqual(1)
    expect(counts.get('D') ?? 0).toBeGreaterThanOrEqual(1)
    expect(counts.get('S') ?? 0).toBeGreaterThanOrEqual(1)
  })

  test('first-party kind-A sites equal the darkVariantTokens GRANDFATHERED table, both ways', () => {
    // Kind A is not a violation — it is remitted to the OTHER guard's named table
    // (the four `LandingPage` `dark:bg-white/10` sites, each measured per site by
    // scripts/measureDarkVariantDeltas.mjs). So this guard must not re-decide them:
    // an A site NOT in that table is a new offender, and a table entry with no A site
    // behind it is a stale permission. The table is READ from that file rather than
    // copied, because a copy is exactly the drift this arrangement exists to prevent.
    const guardSrc = stripComments(
      readFileSync(join(ROOT, 'lib', '__tests__', 'darkVariantTokens.test.ts'), 'utf8'),
    )
    const block = /const GRANDFATHERED = \[([\s\S]*?)\n\]/.exec(guardSrc)
    expect(block).not.toBeNull()
    const tableBody = block?.[1] ?? ''
    expect(tableBody.length).toBeGreaterThan(0)
    const table = [...tableBody.matchAll(/'([^']+)'/g)].map((m) => parseCounted(m[1]))
    expect(table.length).toBeGreaterThanOrEqual(1)

    const tally = (rows: Array<[string, number]>) => {
      const out = new Map<string, number>()
      for (const [key, n] of rows) out.set(key, (out.get(key) ?? 0) + n)
      return out
    }
    const aPairs = RESULT.rule2.firstParty.filter((p) => p.kind === 'A')
    const fromTree = tally(aPairs.map((p) => [`${p.file}:${p.literal}`, 1]))
    const fromTable = tally(table.map((e) => [`${e.file}:${e.value}`, e.count]))
    expect(Object.fromEntries(fromTree)).toEqual(Object.fromEntries(fromTable))
  })

  test('the vendored path exemption is load-bearing, not decorative', () => {
    // Rules 2/3 exempt vendored files by path. If the VENDORED list emptied, the 8
    // vendored pairs — including the 3 hand-spelled scrim pairs (kind B) — would land
    // in the first-party bucket and the zero-violations test above would go red
    // (first-party B is a violation: the first-party scrim is `--overlay` now). If the
    // list wrongly swallowed everything, the vacuity floors above could not be met.
    // So both directions of the partition are load-bearing; here we pin what the
    // vendored side actually holds so its removal is never invisible.
    expect(RESULT.files.vendored.length).toBeGreaterThan(20)
    expect(RESULT.rule2.vendored.length).toBeGreaterThanOrEqual(3)
    expect(RESULT.rule2.vendored.filter((p) => p.kind === 'B').length).toBeGreaterThanOrEqual(1)
    expect(RESULT.rule2.firstParty.filter((p) => p.kind === 'B')).toEqual([])
  })

  test('comments quoting `dark:` pairs are masked out; the code line is counted', () => {
    // The masking claim, on the real file that carries both forms. HeaderClient
    // documents the sanctioned `dark:shadow-none` idiom in a comment block and uses
    // it once in code. Lines are DERIVED rather than hardcoded (103/106/109 today), so
    // an edit above the block re-derives instead of failing on a stale number — what
    // is asserted is the property: every comment occurrence unseen, every code
    // occurrence classified.
    const src = readFileSync(join(ROOT, 'components/HeaderClient.tsx'), 'utf8')
    const lines = src.split('\n')
    const commentLines = lines
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.includes('dark:shadow-none') && t.trimStart().startsWith('//'))
      .map(({ i }) => i + 1)
    const codeLines = lines
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.includes('dark:shadow-none') && !t.trimStart().startsWith('//'))
      .map(({ i }) => i + 1)
    expect(commentLines.length).toBeGreaterThanOrEqual(2)
    expect(codeLines.length).toBeGreaterThanOrEqual(1)

    const pairs = darkPairsIn('components/HeaderClient.tsx', src, COLOR_NAMES, DECLARED_VARS)
    expect(pairs.filter((p) => commentLines.includes(p.line))).toEqual([])
    expect(
      pairs.filter((p) => codeLines.includes(p.line)).map((p) => `${p.line}:${p.literal}:${p.kind}`),
    ).toEqual(codeLines.map((line) => `${line}:dark:shadow-none:S`))

    // Control: WITHOUT masking the very same matcher DOES see the comment lines — so
    // the exclusion above is produced by masking, not by the comments lacking the text.
    const rawOnComments = [...src.matchAll(DARK_RE)].filter((m) =>
      commentLines.includes(src.slice(0, m.index).split('\n').length),
    )
    expect(rawOnComments.length).toBeGreaterThanOrEqual(2)
  })

  test('the per-site delta measurement agrees with the table and the code', () => {
    // The ledger's numbers (8, 2, 4, 8 /255) are claims about rendered pixels, derived
    // by scripts/measureDarkVariantDeltas.mjs from globals.css — it re-reads THIS
    // guard's GRANDFATHERED table, re-counts the sites in the code, and exits non-zero
    // if table, code or census disagree. Spawning it keeps the measurement outside the
    // suite's trust: a test that re-implemented the arithmetic would measure its copy.
    let out = ''
    let failure = ''
    try {
      out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'measureDarkVariantDeltas.mjs')], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
      })
    } catch (e) {
      const err = e as { stderr?: string }
      failure = err.stderr ?? (e instanceof Error ? e.message : String(e))
    }
    expect(failure).toBe('')
    expect(out).toContain('sites measured: 4')
    expect(out).toContain('rounded Δ (dark): 8, 2, 4, 8')
    expect(out).toContain('light Δ is 0 by construction')
  })
})

describe('rule 3 — no Tailwind stock palette class bypasses the token system', () => {
  test('palette classes are caught, including variants, sides and alpha modifiers', () => {
    // Positive control for the one matcher rule 3 has. Variant prefixes, directional
    // sides and `/50` alpha are all spellings the tree could plausibly grow, so each
    // must match — a `/50`-blind or side-blind regex would report a clean tree while
    // missing the next offender written that way.
    const positives: Array<[string, string]> = [
      ['className="bg-red-500"', 'bg-red-500'],
      ['className="text-blue-700"', 'text-blue-700'],
      ['className="bg-slate-50"', 'bg-slate-50'],
      ['className="bg-red-500/50"', 'bg-red-500/50'],
      ['className="border-l-rose-200"', 'border-l-rose-200'],
      ['className="hover:bg-amber-400"', 'bg-amber-400'],
      ['className="dark:bg-emerald-900"', 'bg-emerald-900'],
      ['className="divide-x-neutral-200"', 'divide-x-neutral-200'],
    ]
    for (const [src, expected] of positives) {
      expect(paletteSitesIn('fixture/P.tsx', src).map((s) => s.cls)).toEqual([expected])
    }
  })

  test('semantic colour utilities are not palette, and near-misses do not match', () => {
    // The negatives that make the rule usable. `bg-destructive`, `text-muted-foreground`
    // and `bg-chart-1` are this app's TOKENS — a rule keyed on a shape they resemble
    // would flag the token system itself. `border-b-2` is a width utility whose `b-`
    // looks like the directional-side group; `bg-white` is a literal hue, which is
    // rule 2's/boundary business, not palette.
    const negatives = [
      'className="bg-destructive"',
      'className="text-muted-foreground"',
      'className="border-b-2"',
      'className="bg-surface"',
      'className="text-primary"',
      'className="fill-card"',
      'className="bg-chart-1"',
      'className="bg-white"',
      'className="shadow-lg"',
      "const tone = 'primary-500'",
    ]
    for (const src of negatives) {
      expect(paletteSitesIn('fixture/N.tsx', src), `${src} must not be palette`).toEqual([])
    }
  })

  test('the real tree has zero palette classes, first-party and vendored alike', () => {
    // Tripwire. Vendored is asserted too: rule 3 exempts vendored BY PATH, and a zero
    // there is a fact about the registry files (they use tokens), not a blind spot —
    // the fixture test below proves the partition would move a vendored hit out of the
    // first-party bucket rather than dropping it.
    expect(RESULT.rule3.firstParty).toEqual([])
    expect(RESULT.rule3.vendored).toEqual([])
  })
})

describe('the scan itself: traversal, vendored partition, exclusions', () => {
  test('scan() catches all three rules end-to-end and partitions by path', () => {
    // A synthetic mini-tree, run through the REAL `scan()` — string-level fixtures
    // above prove the matchers; this proves the wiring around them: the file walk,
    // the first-party/vendored split, the `__tests__/` and `*.test.*` exclusions, and
    // that rule 1's exemption is keyed to a named file (absent here, so NOTHING is
    // exempt — a path-keyed exemption would wrongly swallow the vendored hex below).
    const FIXTURE = join(ROOT, 'lib', '__tests__', '__colourScanFixture')
    mkdirSync(join(FIXTURE, 'app', '__tests__'), { recursive: true })
    mkdirSync(join(FIXTURE, 'components', '9ui', 'ui'), { recursive: true })
    mkdirSync(join(FIXTURE, 'components', 'interior'), { recursive: true })
    mkdirSync(join(FIXTURE, 'lib'), { recursive: true })
    try {
      writeFileSync(
        join(FIXTURE, 'app', 'globals.css'),
        ':root {\n  --color-primary: #123456;\n}\n',
      )
      writeFileSync(
        join(FIXTURE, 'app', 'page.tsx'),
        'export const Page = () => <p className="bg-[#123456] bg-red-500" />\n',
      )
      writeFileSync(
        join(FIXTURE, 'components', 'Widget.tsx'),
        'export const Widget = () => (\n' +
          '  <>\n' +
          '    <p className="text-blue-700 dark:bg-[#654321]" />\n' +
          '    <p className="bg-black/45 dark:bg-black/65" />\n' +
          '  </>\n' +
          ')\n',
      )
      writeFileSync(
        join(FIXTURE, 'components', '9ui', 'ui', 'Button.tsx'),
        'export const Button = () => (\n' +
          '  <>\n' +
          '    <p className="bg-green-500 bg-[#00ff00]" />\n' +
          '    <p className="bg-black/45 dark:bg-black/65" />\n' +
          '  </>\n' +
          ')\n',
      )
      writeFileSync(
        join(FIXTURE, 'lib', 'helper.ts'),
        "export const cls = { className: 'bg-[#fedcba]' }\n",
      )
      writeFileSync(
        join(FIXTURE, 'app', '__tests__', 'Skip.tsx'),
        'export const Skip = () => <p className="bg-[#111111] bg-purple-500" />\n',
      )
      writeFileSync(
        join(FIXTURE, 'app', 'skip.test.tsx'),
        "import { expect, test } from 'vitest'\n" +
          'export const Fixture = () => <p className="bg-[#222222] bg-pink-500" />\n' +
          "test('fixture only — scan() must never count this file', () => {\n" +
          '  expect(1).toBe(1)\n' +
          '})\n',
      )

      const r = scan(FIXTURE)

      // Traversal and exclusions: scaffolding files exist with violations in them and
      // must appear in no bucket.
      expect(r.files.app).toEqual(['app/page.tsx'])
      expect(r.files.components).toEqual(['components/Widget.tsx'])
      expect(r.files.lib).toEqual(['lib/helper.ts'])
      expect(r.files.vendored).toEqual(['components/9ui/ui/Button.tsx'])
      const all = [...r.files.app, ...r.files.components, ...r.files.lib, ...r.files.vendored]
      expect(all.filter((f) => f.includes('__tests__') || /\.test\./.test(f))).toEqual([])

      // Rule 1: hex in first-party AND vendored are both found; none is exempt,
      // because the exemption names chart.tsx (absent here) — site-keyed, not path-keyed.
      expect(siteKeys(r.rule1.firstParty)).toEqual([
        'app/page.tsx:1 #123456',
        'components/Widget.tsx:3 #654321',
        'lib/helper.ts:1 #fedcba',
      ])
      expect(siteKeys(r.rule1.vendored)).toEqual(['components/9ui/ui/Button.tsx:3 #00ff00'])
      expect(r.rule1.exempt.every((e: { found: number }) => e.found === 0)).toBe(true)
      expect(r.rule1.unknown.length).toBe(4)

      // Rule 2: the first-party pairs classify (hand hex H, hand scrim B) and the
      // vendored scrim lands in the vendored bucket — B is a violation only first-party.
      expect(
        r.rule2.firstParty.map((p: { literal: string; kind: string }) => `${p.literal}:${p.kind}`),
      ).toEqual(['dark:bg-[#654321]:H', 'dark:bg-black/65:B'])
      expect(firstPartyViolations(r.rule2.firstParty).length).toBe(2)
      expect(r.rule2.vendored.map((p: { kind: string }) => p.kind)).toEqual(['B'])

      // Rule 3: palette found first-party and vendored — the path exemption routes
      // vendored hits to their own bucket instead of dropping them.
      expect(siteKeys(r.rule3.firstParty)).toEqual([
        'app/page.tsx:1 bg-red-500',
        'components/Widget.tsx:3 text-blue-700',
      ])
      expect(siteKeys(r.rule3.vendored)).toEqual([
        'components/9ui/ui/Button.tsx:3 bg-green-500',
      ])

      // The report formats this scan without throwing (it is the same formatter the
      // freshness test compares against the saved file).
      expect(formatCensus(r)).toContain('rule 1 — raw hex literals')
    } finally {
      rmSync(FIXTURE, { recursive: true, force: true })
    }
  })
})

describe('shared infrastructure: census freshness, comment masking, token inventory', () => {
  test('docs/colour-census.txt matches a fresh scan, with a readable first difference', () => {
    // The census is a deliverable AND a claim; a stale file would let the guard and
    // the printed numbers disagree — which is the two-copies failure this whole file
    // is built to avoid. The comparison reports the first differing line rather than
    // a boolean, so a stale run says where to look and what changed.
    const stored = readFileSync(join(ROOT, 'docs', 'colour-census.txt'), 'utf8')
    const fresh = formatCensus(RESULT)
    const a = stored.split('\n')
    const b = fresh.split('\n')
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1
    expect({
      stale: stored !== fresh,
      firstDifference:
        stored === fresh ? null : { line: i + 1, stored: a[i] ?? '<eof>', fresh: b[i] ?? '<eof>' },
    }).toEqual({ stale: false, firstDifference: null })
  })

  test('maskComments and stripComments agree on every scanned file, modulo whitespace', () => {
    // Two comment strippers back this guard: `maskComments` here (keeps offsets so
    // line numbers survive) and the shared `stripComments` helper other guards use.
    // If they ever disagree, this guard and the type-scale/date guards are reading
    // different source — so the agreement is checked on the whole scanned tree, not
    // assumed from similar regexes.
    //
    // Controls make the comparison falsifiable: the two are NOT the same string (mask
    // space-fills, strip deletes), yet collapse to the same text — and mask is
    // length-preserving, which is what makes its line numbers meaningful.
    const sample = 'const a = 1 // note\n/* block */\n'
    expect(maskComments(sample).length).toBe(sample.length)
    expect(maskComments(sample)).not.toBe(stripComments(sample))
    expect(maskComments(sample).replace(/\s+/g, '')).toBe(stripComments(sample).replace(/\s+/g, ''))

    const files = listSourceFiles(ROOT)
    expect(files.length).toBeGreaterThan(150)
    const disagree = files.filter((rel) => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      return maskComments(src).replace(/\s+/g, '') !== stripComments(src).replace(/\s+/g, '')
    })
    expect(disagree).toEqual([])
  })

  test('the classifier resolves against a real, populated token inventory', () => {
    // A classifier fed an EMPTY name set would return N ("unknown token") for every
    // pair — turning the real tree red rather than quiet, but also making the kind
    // matrix above meaningless if both sides were empty at once. Floors plus the
    // specific names the matrix and the tree depend on.
    expect(COLOR_NAMES.size).toBeGreaterThanOrEqual(40)
    for (const name of ['background', 'foreground', 'primary', 'muted', 'border', 'card']) {
      expect(COLOR_NAMES.has(name), `globals.css must declare --color-${name}`).toBe(true)
    }
    expect(DECLARED_VARS.has('overlay')).toBe(true)
    expect(RESULT.colorUtilityCount).toBe(COLOR_NAMES.size)
  })
})
