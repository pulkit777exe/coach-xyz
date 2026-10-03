import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { describeLiveDb, liveTestDbUrl } from './liveDb'
import { runProbeProcess } from './spawnProbe'

// ── The import's batch shape, against real Postgres ──────────────────────────
//
// `importStudents` was one `db.unsafe(insert into students …)` per row plus one
// `insert into team_memberships` per row that carried a team, so a full 500-row
// import was 501 statements (1001 with a team on every row) inside a single
// request. It is now one multi-row
// `insert … select … from jsonb_to_recordset(…)` per 100 rows.
//
// What only a live Postgres can settle, and this is the whole reason for a probe:
//
//  - `RETURNING` cannot see the recordset alias on this connection
//    (`returning r.idx, t.id` → "missing FROM-clause entry for table r"), so the
//    row→id mapping has to come from somewhere else. `id` is generated in the
//    query's own recordset instead.
//  - The batched insert has NO per-column casts, where the per-row `values` list
//    relied on Postgres inferring each parameter from the target column. Both
//    reach `jsonb_to_recordset`'s column-type list, so a mis-typed column writes
//    a wrong value rather than raising.
//  - Grouping rows by IDENTICAL column set, rather than unioning them, is what
//    keeps `students.status`'s `not null default 'active'` reachable. A union
//    writes an explicit NULL where the old code omitted the column, and that
//    raises. This is the assertion that fails loudly if the grouping is replaced.
//
// A subprocess, not an in-process fixture: `tests/aiReportScope.test.ts` installs
// a process-global `mock.module('../src/lib/historyStore')`, Bun shares the
// module registry across test files, and any file sorting after it silently
// receives the mock — `withHistoryStore` returns null, the seed no-ops, and the
// assertions fail in ~0.2ms with no database error anywhere. Green alone, red in
// the suite, for reasons that have nothing to do with the code under test.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'studentImportBatchProbe.ts')

/**
 * This probe writes 1500+ real rows across six scenarios, so it runs in seconds,
 * not the ~900ms median `spawnProbe.ts` budgets for. Two consequences, both of
 * which bit the first version of this file:
 *
 *  - It declares its own `timeoutMs`, per that helper's contract, so a wedged
 *    child costs 60s here instead of the suite's 30s budget (which is also what
 *    per-test `120000` is for — a probe spawn inherits Bun's default 5s
 *    otherwise, and the whole spawn is killed mid-flight).
 *  - It runs ONCE for the whole file. Every scenario is in one process because
 *    they share a seeded fixture and a counting connection; spawning per test
 *    would re-run all six eight times over for no added coverage.
 */
const PROBE_TIMEOUT_MS = 60_000

type ProbeOut =
  | {
      teamless500: { queries: number; imported: number; failed: unknown[]; dupes: number }
      withTeam500: { queries: number; imported: number; failed: unknown[]; dupes: number }
      rowShape: {
        imported: number
        queries: number
        jersey: number | null
        dob: string | null
        joined: string | null
        position: string | null
        team: string | null
        notes: string | null
        memberships: number
      }
      defaultStatus: {
        imported: number
        queries: number
        rows: Array<{ full_name: string; status: string }>
      }
      malformedInBatch: {
        queries: number
        imported: number
        failed: Array<{ row_index: number; reason: string }>
        dupes: number
      }
      badStatusInBatch: {
        queries: number
        imported: number
        failed: Array<{ row_index: number; reason: string }>
        dupes: number
      }
      duplicates: { queries: number; imported: number; failed: unknown[]; dupes: number }
      vanishedTeam: { imported: number; failed: number; mirrored: number }
      unknownField: {
        imported: number
        queries: number
        failed: Array<{ row_index: number; reason: string }>
        emails: string[]
      }
      /**
       * Every assertion the probe made that did not hold, plus any scenario that
       * threw. Empty on a green run. Asserted once below so a thrown scenario is a
       * named failure rather than a silently missing key that every test would then
       * report as `undefined`.
       */
      failures: string[]
    }
  | { ok: false; reason: string }

let probeRun: Promise<ProbeOut> | null = null

/** One spawn for the whole file; every test awaits the same promise. */
const runProbe = (): Promise<ProbeOut> => {
  probeRun ??= (async () => {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    // This probe installs its own connection from TEST_DATABASE_URL and forces
    // DATABASE_URL empty, so it can only ever reach the ephemeral database.
    env.TEST_DATABASE_URL = liveTestDbUrl()
    env.DATABASE_URL = ''
    const proc = await runProbeProcess({
      probe: PROBE,
      cwd: SERVER_DIR,
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
    const last = proc.stdout.trim().split('\n').at(-1) ?? ''
    expect(last, `probe produced no result:\n${proc.stdout}\n${proc.stderr}`).not.toBe('')
    return JSON.parse(last) as ProbeOut
  })()
  return probeRun
}

const ok = (out: ProbeOut) => {
  if ('ok' in out) throw new Error(out.reason)
  return out
}

describeLiveDb('students import batches its writes (live Postgres)', () => {
  test('every probe scenario held', async () => {
    // The probe's own assertions, surfaced by name. It exits non-zero when any
    // failed, so this is mostly about making a THROWN scenario legible: the
    // per-scenario tests below would otherwise all see a missing key.
    const out = ok(await runProbe())
    expect(out.failures).toEqual([])
  }, 120000)

  test('a 500-row import is a handful of statements, not 501', async () => {
    const out = ok(await runProbe())
    expect(out.teamless500.imported).toBe(500)
    expect(out.teamless500.failed).toEqual([])
    // 1 duplicate-detection read + 5 batches of 100. The bound, not the exact
    // number: what is pinned is "not linear in rows".
    expect(out.teamless500.queries).toBeLessThanOrEqual(8)
  }, 120000)

  test('a 500-row import with a team on every row is still a handful', async () => {
    // The team mirror is batched too, so this is 1 read + 5 inserts + 5 mirrors.
    const out = ok(await runProbe())
    expect(out.withTeam500.imported).toBe(500)
    expect(out.withTeam500.failed).toEqual([])
    expect(out.withTeam500.queries).toBeLessThanOrEqual(13)
  }, 120000)

  test('each row still lands in its own correctly-typed column', async () => {
    const out = ok(await runProbe())
    const shape = out.rowShape
    expect(shape.imported).toBe(1)
    // Every differently-typed column asserted, which is what proves the mapping
    // rather than merely that an insert happened — a mis-ordered recordset column
    // list or a missing cast would still insert one row.
    expect(shape.jersey).toBe(17)
    expect(shape.dob).toBe('2008-04-01')
    expect(shape.joined).toBe('2026-01-15')
    expect(shape.position).toBe('guard')
    expect(shape.team).toBe('00000000-0000-4000-8000-0000000000b2')
    // A column the row did not carry must be NULL — not '', not the previous
    // row's value.
    expect(shape.notes).toBeNull()
    // And the team mirror rode along.
    expect(shape.memberships).toBe(1)
  }, 120000)

  test("an omitted status still reaches the column's DEFAULT", async () => {
    const out = ok(await runProbe())
    expect(out.defaultStatus.imported).toBe(2)
    const byName = new Map(out.defaultStatus.rows.map((r) => [r.full_name, r.status]))
    expect(byName.get('Has Status')).toBe('inactive')
    // The load-bearing one. `status` is `not null default 'active'`, so grouping
    // rows by identical column set (statement omits the column) is the only
    // design that lands here; unioning column sets would write NULL and raise.
    expect(byName.get('No Status')).toBe('active')
  }, 120000)

  test('a malformed row inside a batch still fails alone, and the rest import', async () => {
    // The bad row shares the good rows' column set, so it lands in the SAME
    // batch — this is what forces the per-row retry rather than passing because
    // it happened to be batched separately.
    const out = ok(await runProbe())
    expect(out.malformedInBatch.imported).toBe(200)
    expect(out.malformedInBatch.failed).toHaveLength(1)
    expect(out.malformedInBatch.failed[0]?.row_index).toBe(200)
    expect(out.malformedInBatch.failed[0]?.reason).toContain('uuid')
  }, 120000)

  test('a bad status inside a batch also fails alone', async () => {
    // A different error class from the uuid cast — the check constraint — so the
    // retry is shown not to be special-cased for one error message.
    const out = ok(await runProbe())
    expect(out.badStatusInBatch.imported).toBe(200)
    expect(out.badStatusInBatch.failed).toHaveLength(1)
    expect(out.badStatusInBatch.failed[0]?.row_index).toBe(200)
    expect(out.badStatusInBatch.failed[0]?.reason).toContain('students_status_check')
  }, 120000)

  test('duplicate emails inside one batch collapse, first occurrence winning', async () => {
    // The email is claimed during PLANNING, because the batch is one command with
    // no per-row insert to add it from afterwards. Without that, all 300 rows
    // would insert.
    const out = ok(await runProbe())
    expect(out.duplicates.imported).toBe(100)
    expect(out.duplicates.dupes).toBe(200)
    expect(out.duplicates.failed).toEqual([])
  }, 120000)

  test('a vanished team costs one mirror, not the whole batch', async () => {
    // `team_memberships.team_id` references `teams(id)`, so one bad team
    // violates the FK for the whole batched mirror statement. The other players
    // must still be mirrored, and the player whose mirror failed must NOT be
    // reported as a failed import: `students.team_id` is the scope source.
    const out = ok(await runProbe())
    expect(out.vanishedTeam.imported).toBe(3)
    expect(out.vanishedTeam.failed).toBe(0)
    expect(out.vanishedTeam.mirrored).toBe(2)
  }, 120000)

  test('a field with no column is reported, not spliced into the SQL', async () => {
    // The column list is spliced into SQL as identifiers, so it is intersected
    // with `studentInsertCols` — the same allowlist `createStudent` and
    // `updateStudent` filter through. A stray key has always been a `failed` row
    // (Postgres raised "column does not exist" and the catch recorded it); what
    // is asserted here is that it is still a `failed` row, that it names the
    // field, and that its row-mate still imported rather than being dragged down
    // with it.
    const out = ok(await runProbe())
    expect(out.unknownField.imported).toBe(1)
    expect(out.unknownField.failed).toHaveLength(1)
    expect(out.unknownField.failed[0]?.row_index).toBe(1)
    expect(out.unknownField.failed[0]?.reason).toContain('is_admin')
    expect(out.unknownField.emails).toEqual(['known@batch.local'])
  }, 120000)
})
