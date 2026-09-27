// Bun's prepared-statement path (the default, and what `historyStore` uses) sends
// a JS string as a jsonb *string*, so `${JSON.stringify(value)}::jsonb` persists
// the JSON text inside a jsonb scalar instead of the object/array the column's
// type declares. Verified live on Neon across four value shapes: an object of
// booleans, a string map, a nested object and a number array all came back
// `jsonb_typeof = 'string'`.
//
// The failure is silent and downstream code cannot see it. `redactWellness`
// starts `if (!summary || typeof summary !== 'object' || Array.isArray(summary))
// return summary`, so a string passes straight through and the medical
// redaction silently stopped working on persisted analyses; the web's
// `notification.data.href` was undefined after a reload, so every notification
// in the bell lost its link. All 1,362 notification rows and 672 audit rows in
// the live database were jsonb strings before the repair migration in
// `ensureInitialized` unwrapped them.
//
// A fixture cannot catch any of this: it stubs `db` as a plain tag function, so
// the binding never happens. Hence this source-level guard plus the live
// invariant in `scripts/smokeOrgHttp.ts` — between them a reintroduction fails
// immediately, whichever side regresses.
//
// Note the asymmetry that makes this worth asserting rather than trusting: on a
// connection built with `prepare: false` the behaviour INVERTS (a direct object
// bind errors with "invalid input syntax for type json" and the stringify form
// produces the correct object). Nothing in `src/` uses `prepare: false`, but any
// throwaway probe written that way will reach the opposite conclusion.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', 'src')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })

/**
 * `JSON.stringify(...)` immediately followed by a `::jsonb` cast, allowing for the
 * closing brace of the surrounding `${...}` — the form in a tagged template is
 * `JSON.stringify(x)}::jsonb`, so a regex that requires `)::jsonb` misses every
 * write site and passes under mutation.
 */
const STRINGIFY_CAST = /JSON\.stringify\([^)]*\)\s*\}?\s*::jsonb/

describe('jsonb columns are bound as objects, never as their string form', () => {
  test('no module reintroduces the JSON.stringify(... )::jsonb form', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, 'utf8')
      contents.split('\n').forEach((line, index) => {
        // Skip the comments that document the trap: JSDoc/line comments and
        // SQL comments inside a Bun template literal (`-- ...`).
        const trimmed = line.trimStart()
        if (
          trimmed.startsWith('*') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('--') ||
          trimmed.startsWith('/*')
        ) {
          return
        }
        if (STRINGIFY_CAST.test(line)) {
          offenders.push(`${file.replace(SRC, 'src')}:${index + 1}  ${line.trim()}`)
        }
      })
    }
    expect(
      offenders,
      "Bind the value itself as ${value}::jsonb. On Bun's prepared-statement path " +
        'JSON.stringify(x)::jsonb stores a jsonb *string*, which reads back as a ' +
        'string and silently defeats redactWellness and every typed consumer.\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  test('the prepared-statement caveat is recorded where the next person will hit it', () => {
    // The rule is easy to "verify" wrongly, because a probe on a `prepare: false`
    // connection reaches the opposite conclusion. Both facts have to be on the
    // page for the rule to be usable.
    const agents = readFileSync(join(SRC, '..', '..', 'AGENTS.md'), 'utf8')
    expect(agents).toContain('jsonb')
    expect(agents).toMatch(/prepare: false|prepare`?:\s*false/i)
  })
})
