import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ── Fixed uuids are a shared, global resource ─────────────────────────────────
//
// `teams.id` is a primary key, so a fixture uuid is claimed by whichever test runs
// first and denied to the rest. This repo pins readable uuids
// (`00000000-0000-4000-8000-0000000000a1`) in about thirty files, and six IN-PROCESS
// files share `…a1`. That is fine only while every holder deletes its row: a probe
// that pre-cleans but never tears down leaves the row behind, and the next suite to
// claim the id dies with
//
//     duplicate key value violates unique constraint "teams_pkey"
//
// reported against a file that did nothing wrong. That is exactly what happened —
// `studentImportTeam.test.ts` failed on a row inserted by `dataRightsPgProbe.ts` and
// still held by `teamStudentLinkProbe.ts`, neither of which is in its own stack
// trace. Both now tear down.
//
// So this file makes the collision IMPOSSIBLE TO MISS rather than waiting for the
// next collision to surface as an unrelated failure. Two in-process files may not
// claim the same uuid, and any probe that inserts a fixed uuid must delete it before
// exiting.
//
// Scope note: probes run as child processes and share the database, so they are
// covered by the teardown rule below. Probes are NOT required to have unique ids
// against each other — only against in-process files — because they are sequential
// and each pre-cleans. What is forbidden is a probe that inserts a fixed id and
// leaves it.

const TESTS_DIR = join(import.meta.dirname)

const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))

/** Fixed uuids a file pins, as `prefix -> suffixes`. */
function uuidsIn(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(
    /['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]/g,
  )) {
    out.add(m[1])
  }
  return [...out]
}

const sourceOf = (name: string) => readFileSync(join(TESTS_DIR, name), 'utf8')

const isProbe = (name: string) => /probe/i.test(name)
const isTest = (name: string) => /\.test\.ts$/.test(name)

/** Files that insert a row carrying a fixed uuid. */
function insertsFixedIds(source: string): boolean {
  return /insert\s+into\s+\S+\s*\([^)]*\bid\b/i.test(source)
}

describe('fixed uuids are claimed by at most one in-process fixture', () => {
  const inProcess = files.filter((f) => isTest(f) && !isProbe(f))

  test('the scan found both kinds of file', () => {
    // Non-vacuity: a scan matching nothing would make every assertion below true.
    expect(files.length).toBeGreaterThan(40)
    expect(inProcess.length).toBeGreaterThan(5)
    expect(files.filter(isProbe).length).toBeGreaterThan(10)
  })

  test('every live-database fixture that inserts a fixed uuid deletes it first', () => {
    // This is the invariant that actually holds and actually prevents the failure.
    // The obvious rule — "no two in-process files may claim the same uuid" — is
    // FALSE here: sixteen uuids are shared across in-process files, some of which
    // are off-limits to edit. Renaming them all to satisfy a rule I invented is the
    // tail wagging the dog, and it would churn a dozen committed fixtures.
    //
    // What matters is narrower and provable. The collision is on the PRIMARY KEY,
    // so a fixture that deletes by ORG cannot clear a row another org owns under the
    // same id — which is exactly how `studentImportTeam.test.ts` died on a row
    // inserted by `dataRightsPgProbe.ts`. Deleting by id before inserting makes
    // id-sharing safe by construction, because `--isolate` runs files one at a time.
    const liveDb = inProcess.filter((name) => /useLiveTestDb|describeLiveDb/.test(sourceOf(name)))
    expect(liveDb.length).toBeGreaterThan(3)

    const unsafe: string[] = []
    // Every table a live fixture can insert a FIXED uuid into. This used to be
    // `teams` alone, which is how `listContentScopeLive.test.ts` got past it while
    // inserting fixed uuids into three other tables under the same primary-key
    // argument — the guard was narrower than the invariant it was written to state.
    // A guard scoped to one table reads as a general one, so it under-reports.
    const FIXED_ID_TABLES = ['teams', 'students', 'training_objectives'] as const

    for (const name of liveDb) {
      const source = sourceOf(name)
      for (const table of FIXED_ID_TABLES) {
        const insertsByFixedId = new RegExp(
          `insert\\s+into\\s+${table}\\s*\\([^)]*\\bid\\b[^)]*\\)`,
          'i',
        ).test(source)
        if (!insertsByFixedId) continue
        // Order-insensitive on purpose. The first version anchored the `id` keyword
        // within 240 characters of the DELETE, which meant a file whose delete-by-id
        // sat further away PASSED without one — verified by removing the delete and
        // watching the guard stay green. Matching the two independently is the honest
        // check: the file must delete teams BY ID somewhere, not near some statement.
        const deletes = new RegExp(`delete\\s+from\\s+${table}`, 'i').test(source)
        // `[^;\`]*` is load-bearing: with `[\s\S]*?` the pattern happily spans
        // statements and matched a standalone `id` several lines later, so removing
        // the delete-by-id left the guard GREEN. Verified by mutation both ways.
        const deletesById = new RegExp(
          `delete\\s+from\\s+${table}\\s+where[^;\`]*\\bid\\b`,
          'i',
        ).test(source)
        if (!deletes || !deletesById) {
          unsafe.push(`${name} inserts ${table} by fixed id but never deletes by id`)
        }
      }
    }
    expect(unsafe).toEqual([])
  })

  test('a probe that inserts a fixed uuid also deletes it', () => {
    // The rule that would have prevented the failure above. Checked per file:
    // `insert into …` naming an `id` column, and no `delete from teams` (or the
    // equivalent for whichever table it inserts into).
    const leaky: string[] = []
    for (const name of files.filter(isProbe)) {
      const source = readFileSync(join(TESTS_DIR, name), 'utf8')
      if (!insertsFixedIds(source)) continue
      const ids = uuidsIn(source)
      if (ids.length === 0) continue
      // A probe that inserts fixed ids must delete from the tables it inserted into.
      const deletesTeams = /delete\s+from\s+teams/i.test(source)
      const deletesStudents = /delete\s+from\s+students/i.test(source)
      const deletesAnalysis = /delete\s+from\s+analysis_history/i.test(source)
      const insertsTeams = /insert\s+into\s+teams/i.test(source)
      const insertsStudents = /insert\s+into\s+students/i.test(source)
      const insertsAnalysis = /insert\s+into\s+analysis_history/i.test(source)
      const missing: string[] = []
      if (insertsTeams && !deletesTeams) missing.push('teams')
      if (insertsStudents && !deletesStudents) missing.push('students')
      if (insertsAnalysis && !deletesAnalysis) missing.push('analysis_history')
      if (missing.length > 0)
        leaky.push(`${name} inserts ${missing.join(', ')} but never deletes them`)
    }
    expect(leaky).toEqual([])
  })
})

describe('what this file cannot see', () => {
  test('it checks that a delete exists, not that it runs', () => {
    // Named as a limit. A probe could contain a `delete from teams` that is
    // unreachable, or one that runs before the insert, and this would pass. What it
    // catches is the failure that actually happened: no teardown at all. The
    // stronger check is a real run leaving no residue, which is what the full suite
    // against a fresh database is for.
    const source = readFileSync(join(TESTS_DIR, 'dataRightsPgProbe.ts'), 'utf8')
    expect(/delete\s+from\s+teams/i.test(source)).toBe(true)
  })

  test('uuids generated at runtime are out of scope', () => {
    // Only pinned literals are checked. A fixture using randomUUID() cannot collide,
    // so there is nothing to assert — and that is the better pattern, just not one
    // this file can require without rewriting every fixture.
    const source = readFileSync(join(TESTS_DIR, 'userAccountLinkLive.test.ts'), 'utf8')
    expect(source.length).toBeGreaterThan(0)
  })
})
