import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── Tokens existed; nothing required them to be USED ──────────────────────────────
//
// A compiled token audit found nine families of site spelling a value the design system
// already declares. `globals.css` had 56 semantic colour roles, a six-rung type scale, a
// three-step motion scale and four easing curves — and every one of them had call sites
// beside it writing the same value by hand. **A token that is declared and not referenced is
// a comment**, which is the same shape as the type-scale finding: 210 sites spelled a
// documented size as a Tailwind default, so editing `--text-body` would have moved 188 of
// them and left the rest silently behind.
//
// Every finding below was verified by COMPILING, not by reading, and two of them are the
// kind that reading cannot settle:
//
//   `bg-input-fill` EMITS NOTHING. `globals.css` maps only `--color-input: var(--input)`, so
//     the obvious fix for a `--input`-used-as-a-fill is not a spelling that exists. The
//     `var()` form is the ONLY one, and it is what `9ui/ui/input.tsx` already uses — so
//     "use the token" has a correct answer that is not the token's own name.
//   `ease-out` (the bare utility) is NOT a violation: `:root { --ease-out }` sits UNLAYERED
//     after Tailwind's own layered `@theme` default, and unlayered beats layered, so the app
//     value wins. The single largest apparent motion violation in the tree was correct.
//
// The families are asserted as SHAPES (a raw duration, an inline cubic-bezier, a border token
// used as a fill) rather than as the exact literals that happened to be there, so the guard
// catches the next spelling too instead of only the nine it was written against.

const ROOT = join(import.meta.dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}
/** Vendored dirs are registry-faithful and exempt, per DESIGN_FOUNDATIONS.md. */
const firstParty = ['app', 'components']
  .flatMap(sourceFiles)
  .filter((f) => !/(^|\/)(9ui|interior)\//.test(f))
  // `VideoPlayer.tsx` draws to a canvas, which cannot take `var()`, and resolves its score
  // colours at paint time via `getComputedStyle` — the correct answer, not an exception.
  .filter((f) => !f.endsWith('VideoPlayer.tsx'))

const sites = firstParty.map((f) => ({
  file: f.replace(`${ROOT}/`, ''),
  src: readFileSync(join(ROOT, f), 'utf8'),
}))

const offenders = (label: string, re: RegExp): string[] =>
  sites
    .flatMap(({ file, src }) => [...src.matchAll(re)].map((m) => `${file} — ${m[0]}`))
    .map((x) => `${label}: ${x}`)

/**
 * Four `shadow-*` sites that are correct, and WHY — because the reason is a mechanism, not a
 * preference, and a future reader who deletes this list needs to be able to check it.
 *
 * These pass a `shadow-*` into a vendored `DropdownMenuContent` / `DialogContent` whose OWN
 * base already carries `dark:shadow-none` (`9ui/ui/dropdown-menu.tsx:47` and siblings). The
 * pairing therefore still applies in dark mode, and it WINS: `.dark .dark\:shadow-none` is
 * specificity (0,2,0) against the caller's unlayered `.shadow-md` at (0,1,0).
 *
 * The load-bearing half is that **`cn` is a hand-rolled join with no `twMerge`**
 * (`lib/utils.ts:25`), so the base's classes are not de-duplicated away. Add `twMerge` and this
 * exemption becomes wrong — the caller's `shadow-md` would start winning and dark mode would
 * deepen its shadow, which is exactly the regression `HeaderClient.tsx:103-108` documents at
 * length. So this list is coupled to `cn`'s implementation and must be revisited if that
 * changes.
 */
const SHADOW_INHERITS_PAIRING = [
  'components/SidebarSearch.tsx',
  'components/SidebarProfileMenu.tsx',
  'components/org/OrgPill.tsx',
  'components/notifications/NotificationBell.tsx',
]

describe('a declared token is used, not re-spelled', () => {
  test('no border token is used as a field fill', () => {
    // `--input` is on the BORDER ladder. `--input-fill` exists for this job. Measured against
    // the `--card` these sit on: -30/255 in light, +22/255 in dark — wrong in BOTH themes.
    // The `bg-` form only; `border-input` on the same element is correct usage.
    expect(offenders('bg-input', /(?<![\w-])bg-input\b/g)).toEqual([])
  })

  test('no inline font-size where a size utility exists', () => {
    // Three status pills used `style={{ fontSize: 11 }}` while a fourth renders the SAME pill
    // with `text-label`. An inline style is unlayered, so it would beat a utility outright.
    expect(offenders('inline fontSize', /style=\{\{[^}]*fontSize\s*:/g)).toEqual([])
  })

  test('no raw duration literal where a --dur-* token exists', () => {
    // --dur-fast 120ms, --dur-base 180ms, --dur-slow 240ms. Deliberately NOT in @theme, so
    // there is no `duration-fast` utility and the `var()` form is the only spelling.
    expect(offenders('raw duration', /duration-\[(?!\s*var\()\d+m?s\]/g)).toEqual([])
  })

  test('no inline easing cubic-bezier', () => {
    // Byte-for-byte copies of --ease-out. Separately, `[transition-timing-function:ease-in]`
    // emits the CSS KEYWORD `cubic-bezier(0.42,0,1,1)`, which is NOT this app's --ease-in.
    expect(offenders('inline cubic-bezier', /cubic-bezier\(/g)).toEqual([])
  })

  test('no foreground-at-an-alpha hairline where --border is the token', () => {
    // In LIGHT `bg-foreground/9` is byte-identical to `--border`; in DARK they diverge by
    // 4/255 because `--foreground` inverts while `--border` stays white-based. So a hairline
    // written this way is correct in one theme and off in the other — the worst kind of
    // hand-rolled approximation, because half of it is indistinguishable from the token.
    expect(offenders('foreground hairline', /(?<![\w-])(?:bg|divide)-foreground\/9\b/g)).toEqual([])
  })

  test('every shadow pairs with dark:shadow-none', () => {
    // The sanctioned idiom, stated in globals.css and shipped by all six vendored shadowed
    // primitives. HeaderClient.tsx carries a comment about a site that lacked it and DEEPENED
    // its shadow in dark mode. Unpaired shadows are only findable on standalone elements,
    // which is why three were missed.
    const bare = sites.flatMap(({ file, src }) => {
      const out: string[] = []
      // `shadow-none` is excluded in BOTH spellings: the first version excluded only
      // `shadow-[none]`, so it matched the `shadow-none` INSIDE the sanctioned
      // `dark:shadow-none` and then looked forward from the end of the match it had just
      // consumed for the very string it had eaten — a guard that fails on the idiom it exists
      // to sanction. The window also starts at `m.index`, not `m.end()`.
      for (const m of src.matchAll(/(?<![\w-])shadow-(?!none|\[)[a-z0-9[\]().,%-]+/g)) {
        const around = src.slice(m.index, m.index + m[0].length + 26)
        if (!around.includes('dark:shadow-none') && !SHADOW_INHERITS_PAIRING.includes(file)) {
          out.push(`${file} — ${m[0]}`)
        }
      }
      return out
    })
    // Exempt: `dark:shadow-none` alone is the sanctioned pairing, and a `shadow-*` inside a
    // `dark:` variant of something else is out of scope for this shape.
    expect(bare).toEqual([])
  })

  test('the focus ring is one recipe, not three', () => {
    // All six vendored primitives ship `ring-2` at `/40`. A `ring-[3px]` came from the
    // vendored dialog close-button pattern copied onto form fields, and `/50` from hand-rolled
    // pills — so keyboard focus, the only thing marking keyboard position, read at three
    // widths and two intensities.
    expect(offenders('ring width', /(?<![\w-])focus-visible:ring-\[\d+px\]/g)).toEqual([])
    expect(offenders('ring alpha', /(?<![\w-])focus-visible:ring-ring\/(?!40\b)\d+/g)).toEqual([])
  })

  test('the scan is not vacuous, and the matcher demonstrably works', () => {
    // A guard over an empty result cannot detect a broken scan — the failure mode this repo
    // has paid for four separate times. The fixture carries one instance of every shape the
    // assertions above reject, so each matcher is exercised through the same code path.
    expect(firstParty.length).toBeGreaterThan(100)
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'tokenBypasses.tsx'), 'utf8')
    const caught = [
      ...fixture.matchAll(/(?<![\w-])bg-input\b/g),
      ...fixture.matchAll(/style=\{\{[^}]*fontSize\s*:/g),
      ...fixture.matchAll(/duration-\[(?!\s*var\()\d+m?s\]/g),
      ...fixture.matchAll(/cubic-bezier\(/g),
      ...fixture.matchAll(/(?<![\w-])(?:bg|divide)-foreground\/9\b/g),
      ...fixture.matchAll(/(?<![\w-])focus-visible:ring-\[\d+px\]/g),
      ...fixture.matchAll(/(?<![\w-])focus-visible:ring-ring\/(?!40\b)\d+/g),
    ]
    expect(caught.length).toBeGreaterThanOrEqual(7)
  })

  test('the motion tokens the audit relied on are actually declared', () => {
    // If `--dur-fast` or `--ease-out` were removed the var() spellings above would compile to
    // nothing and silently lose their value — the "two owners" drift this repo records for
    // `toIsoString`. Asserted so a rename cannot leave 21 sites referencing a missing token.
    for (const t of [
      '--dur-fast',
      '--dur-base',
      '--dur-slow',
      '--ease-out',
      '--ease-in',
      '--input-fill',
      '--border',
      '--ring',
    ]) {
      expect(CSS, `globals.css must declare ${t}`).toContain(`${t}:`)
    }
  })

  test('the shadow exemptions are only the sites that inherit the pairing', () => {
    // An exemption list is a coverage claim. These four must each still render into a vendored
    // base that carries `dark:shadow-none`, AND `cn` must still have no `twMerge` — the two
    // conditions that make the exemption correct. If either stops holding, this goes red
    // rather than quietly exempting a site that has become a real violation.
    const dropdown = readFileSync(
      join(ROOT, 'components', '9ui', 'ui', 'dropdown-menu.tsx'),
      'utf8',
    )
    expect(dropdown).toContain('dark:shadow-none')
    const utils = readFileSync(join(ROOT, 'lib', 'utils.ts'), 'utf8')
    expect(utils).not.toContain('twMerge')
    for (const f of SHADOW_INHERITS_PAIRING) {
      expect(
        sites.some((x) => x.file === f),
        `${f} is exempt but no longer exists`,
      ).toBe(true)
      expect(readFileSync(join(ROOT, f), 'utf8')).toMatch(/shadow-/)
    }
  })
})
