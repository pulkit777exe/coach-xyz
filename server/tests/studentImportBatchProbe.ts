// `importStudents` round trips and row-level correctness, against ephemeral
// Postgres, in a fresh process.
//
// WHY A SUBPROCESS: `tests/aiReportScope.test.ts` installs a process-global
// `mock.module('../src/lib/historyStore')` and Bun's module registry is shared
// across test files in one run, so any file sorting after it silently receives
// the MOCK — `withHistoryStore` returns null, the seed no-ops, and the
// assertions fail in ~0.2ms with no database error anywhere. Nothing is mocked
// here on purpose; the point is the real SQL.
//
// WHAT IS COUNTED, and what is not: statements are recorded only between the two
// `armed` flags, and the initializer is warmed before counting starts.
// `setHistoryStoreConnectionForTests` nulls the memoised initPromise, so its DDL
// — and the jsonb repair-migration SELECTs, which no keyword filter catches —
// re-runs on every swap. Counting is armed by hand rather than filtered by
// pattern precisely because that repair pass is invisible to a keyword test.
// Each scenario throws on mismatch; a zero exit means all of them held.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { importStudents } from '../src/lib/org/students'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
// Empty so `historyStore`'s own import-time `new SQL(...)` builds nothing and
// this file's connection is the only one. Nothing here can reach live Neon.
process.env.DATABASE_URL = ''

const ORG = 'auth0|import-batch-probe'
const TEAM = '00000000-0000-4000-8000-0000000000b2'

/**
 * Assertions are COLLECTED, not thrown.
 *
 * The first version threw on the first mismatch, which is the usual probe shape
 * (`studentDeletePgProbe.ts` does exactly that) and is wrong here: all six
 * scenarios share this process, so one throw left the remaining five unrun and
 * the suite reported the same "probe exited non-zero" against every test name —
 * eight failures that say nothing about which behaviours actually regressed.
 * Scenarios are independent (each resets its own fixture), so each is wrapped,
 * each records its own outcome, and the process still exits non-zero if any
 * failed. `studentImportBatch.test.ts` then reports per behaviour.
 */
const failures: string[] = []
const check = (cond: boolean, message: string): void => {
  if (!cond) failures.push(message)
}

/** Run one scenario, recording (and reporting) a throw instead of aborting. */
const scenario = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn()
  } catch (err) {
    failures.push(`${name}: threw ${err instanceof Error ? err.message : String(err)}`)
  }
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

// ── Statement counter ────────────────────────────────────────────────────────
// A Proxy over the live connection: a fully stubbed connection cannot run
// `ensureInitialized` at all, which is what made the first attempt at counting
// importStudents fail (and it needs a `get` trap AND an `apply` trap, because a
// Bun `SQL` instance is itself the tagged-template function).
let armed = false
let count = 0
const shapes: string[] = []
const counting = new Proxy(db as unknown as (...a: unknown[]) => unknown, {
  apply(target, _this, a: unknown[]) {
    const text = Array.isArray(a[0])
      ? ((a[0] as unknown as TemplateStringsArray).join('?') ?? '')
      : String(a[0] ?? '')
    if (armed) {
      count++
      if (shapes.length < 8) shapes.push(text.replace(/\s+/g, ' ').slice(0, 70))
    }
    return (target as (...x: unknown[]) => unknown)(...a)
  },
  get(_t, prop) {
    const v = (db as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof v !== 'function') return v
    return (...a: unknown[]) => {
      if (armed) {
        count++
        if (shapes.length < 8) {
          shapes.push(
            `${String(prop)} ${String(a[0] ?? '')
              .replace(/\s+/g, ' ')
              .slice(0, 70)}`,
          )
        }
      }
      return (v as (...x: unknown[]) => unknown).apply(db, a)
    }
  },
}) as unknown as SQL

// Fixture teardown by id, not by org: these uuids are deliberately memorable and
// therefore shared across probes, so a delete scoped only to this file's org
// would leave another probe's row and the next insert would collide on the PK.
const reset = async (): Promise<void> => {
  await db`delete from students where auth0_id = ${ORG}`
  await db`delete from teams where id = ${TEAM}::uuid`
  await db`
    insert into teams (id, org_auth0_id, name, sport)
    values (${TEAM}::uuid, ${ORG}, 'Import Batch Team', 'soccer');
  `
}

// Count one import, with the initializer already warm so its DDL is not charged.
//
// The ORDER here is load-bearing and was the first thing that went wrong:
// `setHistoryStoreConnectionForTests` nulls the memoised `initPromise`, so the
// initializer re-runs — ~100 statements including jsonb repair SELECTs — on the
// first wrapped call after every swap. Warming BEFORE the swap therefore warms
// the connection being replaced, and the counted call pays for all of it (this
// probe reported 127 queries for 500 rows that way, i.e. 6 real statements plus
// the initializer). Swap first, then warm.
const countImport = async (
  rows: Array<{ cleaned: Record<string, unknown> }>,
): Promise<{
  queries: number
  imported: number
  failed: unknown[]
  dupes: number
  shapes: string[]
}> => {
  await reset()
  setHistoryStoreConnectionForTests(counting)
  await importStudents(ORG, []) // no-op call, but it runs ensureInitialized
  count = 0
  shapes.length = 0
  armed = true
  const result = await importStudents(ORG, rows)
  armed = false
  return {
    queries: count,
    imported: result.imported,
    failed: result.failed,
    dupes: result.duplicates_skipped,
    shapes: [...shapes],
  }
}

const row = (i: number, team?: string) => ({
  cleaned: {
    full_name: `Player ${i}`,
    email: `p${i}@batch.local`,
    jersey_number: (i % 40) + 1,
    status: 'active',
    notes: 'x'.repeat(40),
    ...(team ? { team_id: team } : {}),
  },
})

/**
 * The shape of the printed object. Declared rather than left as
 * `Record<string, unknown>`: assigning into a closure narrows the property for
 * the rest of that closure only, so the reads after the `await scenario(...)`
 * bodies reported `unknown` under `tsc -p tsconfig.tests.json`.
 */
type BatchCounts = { queries: number; imported: number; failed: unknown[]; dupes: number }
type ProbeShape = {
  teamless500: BatchCounts & { shapes: string[] }
  withTeam500: BatchCounts & { shapes: string[] }
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
  malformedInBatch: BatchCounts & { shapes: string[] }
  badStatusInBatch: BatchCounts & { shapes: string[] }
  duplicates: BatchCounts & { shapes: string[] }
  vanishedTeam: { imported: number; failed: number; mirrored: number }
  unknownField: {
    imported: number
    queries: number
    failed: Array<{ row_index: number; reason: string }>
    emails: string[]
  }
  failures: string[]
}

const out = {} as ProbeShape

// ── 1. Query counts at the cap ───────────────────────────────────────────────
// The whole point: one statement per batch of 100, not one per row.
await scenario('teamless500', async () => {
  out.teamless500 = await countImport(Array.from({ length: 500 }, (_, i) => row(i)))
  check(out.teamless500.imported === 500, `expected 500 imported, got ${out.teamless500.imported}`)
  check(
    (out.teamless500 as { queries: number }).queries <= 8,
    `expected <= 8 queries for 500 rows, got ${(out.teamless500 as { queries: number }).queries}`,
  )
})

await scenario('withTeam500', async () => {
  out.withTeam500 = await countImport(Array.from({ length: 500 }, (_, i) => row(i, TEAM)))
  check(out.withTeam500.imported === 500, `expected 500 imported, got ${out.withTeam500.imported}`)
})

// ── 2. The batched path really wrote the rows, and each into its OWN column ──
// A mis-ordered placeholder list or a mis-typed recordset column would still
// insert 500 rows; asserting every differently-typed column is what proves the
// mapping, which is exactly what `studentImportTeamProbe.ts` case 4 does for the
// single-row path.
await scenario('rowShape', async () => {
  out.rowShape = await (async () => {
    await reset()
    setHistoryStoreConnectionForTests(counting)
    await importStudents(ORG, [])
    count = 0
    shapes.length = 0
    armed = true
    const result = await importStudents(ORG, [
      {
        cleaned: {
          full_name: 'Shape Row',
          email: 'shape@batch.local',
          jersey_number: '17',
          date_of_birth: '2008-04-01',
          joined_on: '2026-01-15',
          position: 'guard',
          status: 'active',
          team_id: TEAM,
        },
      },
    ])
    armed = false
    // Reads below run on the raw connection with `armed` already false, so they are
    // not counted; the `count` captured here is the import's own statements.
    const written = await db<
      {
        jersey_number: number | null
        date_of_birth: Date | string | null
        joined_on: Date | string | null
        position: string | null
        team_id: string | null
        notes: string | null
      }[]
    >`
    select jersey_number, date_of_birth, joined_on, position, team_id, notes
    from students where auth0_id = ${ORG} and email = ${'shape@batch.local'};
  `
    const rowOut = written[0]
    // Bun decodes a `date` column to a Date, so normalise at the boundary rather
    // than comparing an ISO string to an object (the class of lie AGENTS.md
    // records for timestamptz).
    const iso = (v: Date | string | null): string | null =>
      v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : v
    return {
      imported: result.imported,
      queries: count,
      jersey: rowOut?.jersey_number ?? null,
      dob: iso(rowOut?.date_of_birth),
      joined: iso(rowOut?.joined_on),
      position: rowOut?.position ?? null,
      team: rowOut?.team_id ?? null,
      // A column the row did not carry must be NULL, not '' and not absent.
      notes: rowOut?.notes ?? null,
      memberships: (
        await db`select count(*)::int as n from team_memberships where student_id in (select id from students where auth0_id = ${ORG})`
      )[0].n,
    }
  })()
  check(out.rowShape.imported === 1, 'the single row did not import')
  check(out.rowShape.jersey === 17, `jersey_number landed as ${out.rowShape.jersey}`)
  check(out.rowShape.dob === '2008-04-01', `date_of_birth landed as ${out.rowShape.dob}`)
  check(out.rowShape.joined === '2026-01-15', `joined_on landed as ${out.rowShape.joined}`)
  check(out.rowShape.position === 'guard', `position landed as ${out.rowShape.position}`)
  check(out.rowShape.team === TEAM, `team_id landed as ${out.rowShape.team}`)
  check(out.rowShape.notes === null, `an absent column became ${out.rowShape.notes}`)
  check(out.rowShape.memberships === 1, `expected 1 team mirror, got ${out.rowShape.memberships}`)
})

// ── 3. `status` absent must still reach its DEFAULT ──────────────────────────
// `students.status` is `not null default 'active'`. A batch built by UNIONING
// column sets would write an explicit NULL here and raise; grouping by identical
// column sets is what keeps the default reachable. This is the assertion that
// distinguishes the two designs.
await scenario('defaultStatus', async () => {
  out.defaultStatus = await (async () => {
    await reset()
    setHistoryStoreConnectionForTests(counting)
    await importStudents(ORG, []) // warm the initializer on the counting connection
    count = 0
    shapes.length = 0
    armed = true
    // Two rows with DIFFERENT column sets in one call: one with a status, one
    // without. They must not be merged into one union-ed statement.
    const result = await importStudents(ORG, [
      { cleaned: { full_name: 'Has Status', email: 'has@batch.local', status: 'inactive' } },
      { cleaned: { full_name: 'No Status', email: 'none@batch.local' } },
    ])
    armed = false
    const rows = await db<{ full_name: string; status: string }[]>`
      select full_name, status from students where auth0_id = ${ORG} order by full_name;
    `
    return { imported: result.imported, queries: count, rows }
  })()
  check(out.defaultStatus.imported === 2, 'both rows should import')
  const statusRows = out.defaultStatus
  check(statusRows.rows.length === 2, `expected 2 rows, got ${statusRows.rows.length}`)
  // The assertion that separates grouping by column set from unioning them: the
  // row that carried no `status` must land on the column DEFAULT 'active', which
  // only happens if its statement simply omitted the column.
  check(
    statusRows.rows.find((r) => r.full_name === 'Has Status')?.status === 'inactive',
    `the explicit status was not honoured: ${JSON.stringify(statusRows.rows)}`,
  )
  check(
    statusRows.rows.find((r) => r.full_name === 'No Status')?.status === 'active',
    `an omitted status did not reach its default: ${JSON.stringify(statusRows.rows)}`,
  )
})

// ── 4. Per-row error isolation survives batching ─────────────────────────────
// The contract `tests/studentImportTeamProbe.ts` case 3 pins, at batch scale and
// with the bad row sharing the good rows' column set so it lands in the SAME
// batch — which is what forces the per-row retry.
await scenario('malformedInBatch', async () => {
  out.malformedInBatch = await countImport([
    ...Array.from({ length: 200 }, (_, i) => row(i, TEAM)),
    {
      cleaned: {
        full_name: 'Bad Team',
        email: 'bad-team@batch.local',
        jersey_number: 9,
        status: 'active',
        notes: 'x'.repeat(40),
        team_id: 'not-a-uuid',
      },
    },
  ])
  check(
    out.malformedInBatch.imported === 200,
    `expected 200 imported, got ${out.malformedInBatch.imported}`,
  )
  check(
    (out.malformedInBatch.failed as unknown[]).length === 1,
    `expected exactly 1 failure, got ${JSON.stringify(out.malformedInBatch.failed)}`,
  )
  check(
    (out.malformedInBatch.failed as Array<{ row_index: number }>)[0]?.row_index === 200,
    `expected row_index 200, got ${JSON.stringify(out.malformedInBatch.failed)}`,
  )
})

// A status outside the vocabulary trips the check constraint instead — a
// different error class from the uuid cast, and the retry must handle both.
await scenario('badStatusInBatch', async () => {
  out.badStatusInBatch = await countImport([
    ...Array.from({ length: 200 }, (_, i) => row(i)),
    {
      cleaned: {
        full_name: 'Bad Status',
        email: 'bad-status@batch.local',
        jersey_number: 9,
        status: 'bogus',
        notes: 'x'.repeat(40),
      },
    },
  ])
  check(
    out.badStatusInBatch.imported === 200,
    `expected 200 imported, got ${out.badStatusInBatch.imported}`,
  )
  check(
    (out.badStatusInBatch.failed as unknown[]).length === 1,
    `expected exactly 1 failure, got ${JSON.stringify(out.badStatusInBatch.failed)}`,
  )
})

// ── 5. Intra-batch duplicate emails collapse, and the FIRST one wins ─────────
// The email is claimed during planning precisely because the batch is one
// command with no per-row insert to add it from afterwards. 300 rows / 100
// distinct emails must be 100 imported and 200 skipped, NOT 300.
await scenario('duplicates', async () => {
  out.duplicates = await countImport(
    Array.from({ length: 300 }, (_, i) => ({ cleaned: row(i % 100).cleaned })),
  )
  check(out.duplicates.imported === 100, `expected 100 imported, got ${out.duplicates.imported}`)
  check(out.duplicates.dupes === 200, `expected 200 skipped, got ${out.duplicates.dupes}`)
})

// ── 6. A vanished team must not cost the other mirrors ───────────────────────
// `team_memberships.team_id` references `teams(id)`, so one bad team violates
// the FK for the whole batch statement. The fallback restores per-row
// log-and-continue: the OTHER players still get their mirror.
await scenario('vanishedTeam', async () => {
  out.vanishedTeam = await (async () => {
    await reset()
    setHistoryStoreConnectionForTests(counting)
    await importStudents(ORG, [])
    const gone = '00000000-0000-4000-8000-0000000000ff'
    count = 0
    shapes.length = 0
    armed = true
    const result = await importStudents(ORG, [row(1, TEAM), row(2, gone), row(3, TEAM)])
    armed = false
    const mirrored = await db<{ n: number }[]>`
      select count(*)::int as n from team_memberships
      where student_id in (select id from students where auth0_id = ${ORG});
    `
    return { imported: result.imported, failed: result.failed.length, mirrored: mirrored[0].n }
  })()
  const vanished = out.vanishedTeam
  check(vanished.imported === 3, `expected 3 imported, got ${vanished.imported}`)
  check(
    vanished.failed === 0,
    'a failed team mirror must not row-fail the player (team_id is the scope source)',
  )
  check(
    vanished.mirrored === 2,
    `expected 2 mirrors (the two real team rows), got ${vanished.mirrored}`,
  )
})

// ── 7. The column allowlist ──────────────────────────────────────────────────
// `cols` is spliced into SQL as identifiers, so it is intersected with
// `studentInsertCols` — the same allowlist `createStudent`/`updateStudent` use.
// A key outside it is a `failed` row naming the field, which is the outcome the
// per-row `values` list produced anyway (Postgres raised "column does not exist"
// and the catch recorded it). Silently dropping it would not be.
await scenario('unknownField', async () => {
  await reset()
  setHistoryStoreConnectionForTests(counting)
  await importStudents(ORG, [])
  count = 0
  shapes.length = 0
  armed = true
  const result = await importStudents(ORG, [
    { cleaned: { full_name: 'Known Only', email: 'known@batch.local' } },
    {
      cleaned: {
        full_name: 'Has Stray Field',
        email: 'stray@batch.local',
        jersey_number: 3,
        is_admin: true,
      } as Record<string, unknown>,
    },
  ])
  armed = false
  const written = await db<{ email: string }[]>`
    select email from students where auth0_id = ${ORG} order by email;
  `
  out.unknownField = {
    imported: result.imported,
    queries: count,
    failed: result.failed,
    emails: written.map((r) => r.email),
  }
  // Inside the scenario, not after it: a scenario that threw leaves its key
  // unset, and a check outside would then crash on `undefined` instead of
  // recording the real reason.
  const got = out.unknownField
  check(got.imported === 1, `expected 1 imported, got ${got.imported}`)
  check(got.failed.length === 1, `expected 1 failure, got ${JSON.stringify(got.failed)}`)
  check(
    (got.failed[0]?.reason ?? '').includes('is_admin'),
    `the unknown field should be named: ${JSON.stringify(got.failed)}`,
  )
  check(
    JSON.stringify(got.emails) === JSON.stringify(['known@batch.local']),
    `only the known row should be written: ${JSON.stringify(got.emails)}`,
  )
})

await reset()
await db.close()
// One JSON line, then a non-zero exit if any scenario failed — the probe's
// contract (see tests/spawnProbe.ts). The test file asserts per scenario from
// the object; `failures` is here so a thrown scenario is diagnosable from the
// child's own output instead of only as a missing key.
console.log(JSON.stringify({ ...out, failures }))
if (failures.length > 0) process.exit(1)
