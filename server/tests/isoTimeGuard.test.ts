import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── One normaliser for a decoded Date, and this is the tripwire ──────────────
//
// A SOURCE-LEVEL guard, and saying so matters: it reads source, it does not run
// anything, so it cannot tell you the normalisation is *correct* — only that a
// private copy has not reappeared. `tests/isoTime.test.ts` covers the behaviour.
// Same division of labour as `jsonbBind.test.ts` and `typeScale.test.ts`.
//
// Why a guard is needed for a two-function module: the copies it replaced were
// six byte-identical `toIsoString`s across four files plus two more in
// `performance.ts`, and AGENTS.md's standing instruction had been to collapse
// them rather than add a sixth. They persisted because nothing distinguishes a
// copy from the original until you diff them, so the collapse alone does not
// stop the next one. A `date` column decoded to a Date is the same trap one
// layer over, and there the copies were inline `.slice(0, 10)` truncations.
//
// Both patterns below are the *shape* of a private copy, deliberately narrow so
// an honest `row.created_at.toISOString()` is not flagged — that is a real use,
// not a re-implementation.

const SRC = join(import.meta.dir, '..', 'src')

/** Every .ts under src/, excluding the module that owns the normalisation. */
const sources = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, acc)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full)
  }
  return acc
}

/**
 * Modules that legitimately CONTAIN the pattern because they own it, or because
 * they were deliberately left alone.
 *
 * Exempting by path is the honest form of this guard. The alternative — pretending
 * the shape is never legitimate — produced a false positive on my own first
 * version: `orgValidate.ts` holds `toDateOnly`, whose body IS
 * `.toISOString().slice(0, 10)`, so the guard failed on the module that fixes the
 * bug. A guard that fires on its own implementation gets deleted.
 */
const OWNS_THE_PATTERN = [
  join('lib', 'isoTime.ts'), // toIsoString / toOptionalIsoString
  join('lib', 'orgValidate.ts'), // toDateOnly — the `date`-column SSOT
]

const files = sources(SRC).filter((f) => !OWNS_THE_PATTERN.some((x) => f.endsWith(x)))
const rel = (f: string) => f.slice(SRC.length + 1)

/**
 * Strip comments before matching.
 *
 * Without this the guard read PROSE. My own comment on `exportFilename` quotes the
 * old expression (`.toISOString().slice(0, 10)`) to say it is gone, and the guard
 * failed on its own documentation. That direction is the dangerous one: a comment
 * can also SATISFY a guard, so a source guard that does not strip comments can pass
 * on a module whose implementation was deleted and left behind in a doc block.
 *
 * Naive about `//` inside a string literal (a URL). That cannot manufacture a false
 * positive — it can only hide code, and the patterns here have no `//` in them.
 */
const code = (f: string): string =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('a decoded Date is normalised in exactly one place', () => {
  test('the corpus is non-trivial, so a green guard means something', () => {
    // A guard whose glob matches nothing is a comment. Cheap, and it is the first
    // thing that breaks when a path moves.
    expect(files.length).toBeGreaterThan(80)
  })

  test('no module re-derives the timestamptz conversion', () => {
    // The exact shape of the six copies: parse a string, or hand back the Date.
    const re = /instanceof Date[\s\S]{0,80}?\.toISOString\(\)\s*:\s*new Date\(/
    const offenders = files.filter((f) => re.test(code(f)))
    expect(offenders.map(rel)).toEqual([])
  })

  test('no module re-derives the date truncation', () => {
    // `.slice(0, 10)` on an ISO instant is the `date`-column answer. There were
    // three inline copies of it — `routes/org/reports.ts`, `dataExport`'s export
    // filename and `notificationDigest`'s day grouping — all now citing
    // `toDateOnly`. The exempt list above is where `toDateOnly` itself lives.
    const re = /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/
    const offenders = files.filter((f) => re.test(code(f)))
    expect(offenders.map(rel)).toEqual([])
  })

  test('the modules that used to carry a copy now cite the shared one', () => {
    // The other direction: not merely "no copies", but "the seven call sites
    // still work", so a copy cannot be deleted along with its import and leave a
    // module silently un-normalised.
    for (const f of [
      'lib/consents.ts',
      'lib/notificationPrefs.ts',
      'lib/privacyRequests.ts',
      'lib/userSettings.ts',
      'lib/org/settings.ts',
      'lib/org/performance.ts',
    ]) {
      expect(readFileSync(join(SRC, f), 'utf8')).toContain('isoTime')
    }
  })
})
