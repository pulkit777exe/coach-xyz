import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// ── Disabled was a state with four different renderings ──────────────────────────────
//
// `--opacity-disabled` did not exist, so **19 first-party sites picked one of four
// different opacities**: `disabled:opacity-30` x4, `opacity-40` x1, `opacity-50` x13,
// `opacity-60` x1. Every one of them looked deliberate, and a user moving between a chat
// input at 50% and an attendance grid at 40% would see two different notions of what
// "disabled" means in the same product.
//
// This is the same defect as the type-scale one, one layer down: the utilities exist so the
// value "moves from one place", and a state with no token cannot move. The token is now
// declared in `:root` and exposed through an `@utility`, matching the `text-*` pattern
// already proven in `globals.css` — and `disabled:` being a VARIANT that applies to
// `@utility` was verified in the BUILT CSS rather than assumed, because nothing else in this
// file had ever put a variant on a custom utility.
//
// Normalising onto 0.5 (the plurality, and what 13 of 19 already rendered) changed the
// opacity of 6 sites and nothing else. Vendored `9ui/**` and `interior/**` keep their own
// values: they are registry-faithful, which is a recorded decision, not an oversight.

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

const firstParty = ['app', 'components']
  .flatMap(sourceFiles)
  .filter((f) => !/(^|\/)(9ui|interior)\//.test(f))

const offenders: string[] = []
for (const f of firstParty) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  for (const m of src.matchAll(/(?<![\w-])disabled:opacity-(?!\bdisabled\b)\d+\b/g)) {
    offenders.push(`${f.replace(`${ROOT}/`, '')} — ${m[0]}`)
  }
}

describe('the disabled state is one token, not four literals', () => {
  test('no component hardcodes a disabled opacity', () => {
    // Named, so a failure says which file rather than a count.
    expect(offenders).toEqual([])
  })

  test('the token exists and resolves to a real opacity', () => {
    const decl = /--opacity-disabled:\s*([\d.]+)\s*;/.exec(CSS)
    expect(decl, 'globals.css must declare --opacity-disabled').not.toBeNull()
    const v = Number(decl![1])
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  test('the utility is defined over that token, not over a literal', () => {
    // If the utility hardcoded `opacity: 0.5` then the token would be decorative and a
    // later edit to the token would change nothing — the exact "two owners" drift this
    // repo records for `toIsoString` and `initials`.
    const util = /@utility opacity-disabled\s*\{([^}]*)\}/.exec(CSS)
    expect(util, 'globals.css must define @utility opacity-disabled').not.toBeNull()
    expect(util![1]).toContain('var(--opacity-disabled)')
    expect(util![1]).not.toMatch(/opacity:\s*0?\.\d/)
  })

  test('the token is reachable from a component', () => {
    // The scan is not vacuous: it must be finding classNames at all, and the pattern the
    // assertion rejects must demonstrably be caught. A guard over an empty result cannot
    // detect a broken scan — the failure mode this repo has paid for four times.
    expect(firstParty.length).toBeGreaterThan(100)
    const users = firstParty.filter((f) =>
      readFileSync(join(ROOT, f), 'utf8').includes('disabled:opacity-disabled'),
    )
    expect(users.length).toBeGreaterThan(0)

    // Positive control: the same matcher over a fixture carrying two numeric disabled
    // opacities and one token usage. Only the two numerics may be reported.
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'disabled.tsx'), 'utf8')
    const found = [...fixture.matchAll(/(?<![\w-])disabled:opacity-(?!\bdisabled\b)\d+\b/g)].map(
      (m) => m[0],
    )
    expect(found).toEqual(['disabled:opacity-30', 'disabled:opacity-70'])
  })
})
