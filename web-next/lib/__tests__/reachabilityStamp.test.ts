import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── AGENTS.md states reachability figures as fact; this is what keeps them facts ─
//
// This repo has paid for unguarded numbers three times in one round: the CI
// baseline was stale in three places, the reachability block in six, and the
// a11y sweep's skip list carried two reasons that no longer reproduced — each
// unnoticed because prose has no staleness detection while the guards do. The
// skip list is the model worth copying: `EXPECTED_SKIPS` FAILED the moment the
// exclusions changed, which is the only reason anyone noticed.
//
// So the figures in AGENTS.md and `docs/runbooks/coverage.md` are pinned to a
// live run of the script itself. Re-derive, then re-stamp — the test names which
// sentence disagrees.

// `<root>/web-next/lib/__tests__/this.test.ts` → `<root>`. Note this is the
// REPO root: `scripts/webReachability.mjs` lives at the root, not under
// `web-next/scripts/`, and invoking it from the wrong directory is a documented
// way to get "no such file" rather than a number.
const ROOT = join(import.meta.dirname, '..', '..', '..')

const runReachability = (): string =>
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'webReachability.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })

/** A labelled integer from the script's summary block. */
const field = (out: string, label: string): number => {
  const m = out.match(new RegExp(`^${label}\\s+(\\d+)\\b`, 'm'))
  if (!m) {
    throw new Error(
      `reachability output has no "${label}" line — the script's format changed, so the stamp is unreadable`,
    )
  }
  return Number(m[1])
}

/** A labelled percentage rendered as `NN.N% of files`. */
const percentOfFiles = (out: string, label: string): string => {
  const m = out.match(new RegExp(`^\\s*${label}\\s+([\\d.]+)% of files`, 'm'))
  if (!m) throw new Error(`reachability output has no "${label}" percentage`)
  return m[1]
}

/** A labelled `(NN.N%)` percentage on the "lines in …" lines. */
const percentOfLines = (out: string, label: string): string => {
  const m = out.match(new RegExp(`^\\s*${label}\\s+\\d+\\s+\\(([\\d.]+)%\\)`, 'm'))
  if (!m) throw new Error(`reachability output has no "${label}" percentage`)
  return m[1]
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('the reachability figures AGENTS.md states are re-derivable', () => {
  const out = runReachability()

  test('the saved run is byte-current', () => {
    // `docs/web-reachability.txt` is what the ledger cites as "last run saved".
    // A dated file that no longer matches the tree is worse than none: it reads
    // as evidence.
    expect(read('docs/web-reachability.txt')).toBe(out)
  })

  test('every figure the ledger quotes parses out of a live run', () => {
    // Non-vacuity, asserted before the comparison so a format change fails as a
    // parse error naming the field rather than as an unexplained string mismatch.
    const figures = {
      source: field(out, 'source files'),
      tests: field(out, 'test files'),
      static: field(out, 'statically imported by a test'),
      sweep: field(out, 'loaded only by a generic sweep'),
      untouched: field(out, 'touched by nothing at all'),
      edge: percentOfFiles(out, 'static import edge'),
      lines: percentOfLines(out, 'lines in untouched files'),
    }
    for (const [k, v] of Object.entries(figures)) {
      expect(v, `figure "${k}" did not parse`).not.toBe(0)
    }

    expect(read('AGENTS.md')).toContain(
      `${figures.source} source files / ${figures.tests} test files → ${figures.static} statically imported (${figures.edge}%), ${figures.sweep} loaded only by the generic render sweep, ${figures.untouched} touched by nothing (${figures.lines}% of lines)`,
    )
    // Same figures, different sentence, in the runbook a reader opens for detail.
    // The date is deliberately NOT asserted — it is a stamp to update by hand, and
    // asserting it would only add friction without adding a fact.
    expect(read('docs/runbooks/coverage.md')).toContain(
      `**${figures.source} source files, ${figures.tests} test files, ${figures.static} statically imported (${figures.edge}%)**, ${figures.sweep} loaded only by the generic render sweep, ${figures.untouched} touched by nothing (${figures.lines}% of lines)`,
    )
  })

  test('the two claims the ledger draws from the figures still hold', () => {
    // "49 of the 54 untouched files are `app/` route modules — the other five
    // are `lib/`". A partition claim is only true while the parts sum to the
    // whole, so assert the arithmetic rather than quoting the prose back.
    const app = out.match(/^ {2}app\s+(\d+) files\s+(\d+) lines$/m)
    const lib = out.match(/^ {2}lib\s+(\d+) files\s+(\d+) lines$/m)
    expect(app, 'no app/ line in the untouched breakdown').not.toBeNull()
    expect(lib, 'no lib/ line in the untouched breakdown').not.toBeNull()
    expect(Number(app![1]) + Number(lib![1])).toBe(field(out, 'touched by nothing at all'))

    // "that list is now **one**: `SettingsClient.tsx` (162)". If a second
    // component loses its test — or this one gains one — the count and the line
    // figure move, and the ledger must say so rather than describe the past.
    // Match only the indented data lines, not the section's own header line —
    // and stop at the next section, or the "25 largest untouched files" table
    // (same `indent + number + path` shape) would be swept into the count.
    const block = (out.split('components with NO test written for them')[1] ?? '').split(
      'the 25 largest untouched files',
    )[0]
    const sweptOnly = block.split('\n').filter((l) => /^\s{4,}\d+\s+\S/.test(l))
    expect(sweptOnly, 'the sweep-only component list changed shape').toHaveLength(1)

    const [, lines, file] = sweptOnly[0].match(/^\s*(\d+)\s+(.+)$/) ?? []
    // The script prints a repo-rooted path; the ledger quotes the basename, so
    // compare on that — a full-path assertion would pass while the prose went stale.
    const base = file?.split('/').pop()
    expect(base, 'the one sweep-only component is no longer SettingsClient.tsx').toBe(
      'SettingsClient.tsx',
    )
    expect(read('AGENTS.md')).toContain(`\`${base}\` (${lines})`)
  })
})
