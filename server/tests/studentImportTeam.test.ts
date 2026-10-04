import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { withHistoryStoreOrThrow } from '../src/lib/historyStore'
import { importStudents } from '../src/lib/org/students'
import { validateStudentRow } from '../src/lib/orgValidate'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── The import's team column, against real Postgres ──────────────────────────
//
// `POST /students/import` takes a `team_id` so a caller scoped to a team can no
// longer create players outside their roster (routes/org/students.ts). The value
// has to survive the trip, and that is the part no fixture can check:
// `importStudents` builds `insert into students (auth0_id, <cols>)` from the
// cleaned row's own keys and binds positionally through `db.unsafe(sql, values)`
// with NO per-column casts, while the sibling `updateStudent` MUST carry
// explicit casts because a SET assignment gives Postgres nothing to infer from.
// Two sibling builders, two different cast requirements, and only a real row
// tells them apart.
//
// IN-PROCESS, and that is a load-bearing choice rather than the default. This
// used to spawn `studentImportTeamProbe.ts` once per case, for module isolation
// from `aiReportScope.test.ts`'s global `mock.module`. The suite now runs
// `--isolate` (a fresh module registry per file), so that reason is gone — and
// the subprocess was actively expensive: a fresh process re-runs
// `ensureInitialized`, so each of the four spawns paid the whole schema replay
// against a remote database. Measured: 15s wall for 0.4s of CPU, i.e. all
// network, and each spawn blew the 10s PROBE_TIMEOUT_MS and failed as "did not
// finish within 10000ms" with the real cause nowhere in the output.
//
// That is also the other rule this file now obeys: one concern per file, and a
// live-database suite that SPAWNS NOTHING (cf. orgTeamScopeLive.test.ts). One
// seed, one cleanup, one schema init, four assertions.

const ORG = 'auth0|import-team-probe'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'

const seed = async (db: SQL) => {
  await db`delete from students where auth0_id = ${ORG}`
  // By ID, not by org: `teams.id` is the primary key, and another fixture may hold
  // this uuid under a DIFFERENT org — which an org-scoped delete cannot see, so the
  // insert below died with `duplicate key value violates unique constraint
  // "teams_pkey"` in a file that had done nothing wrong.
  await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid)`
  await db`delete from teams where org_auth0_id = ${ORG}`
  await db`
    insert into teams (id, org_auth0_id, name, sport) values
      (${TEAM_A}::uuid, ${ORG}, 'Import Team A', 'soccer'),
      (${TEAM_B}::uuid, ${ORG}, 'Import Team B', 'soccer');
  `
}

const cleanup = async (db: SQL) => {
  await db`delete from students where auth0_id = ${ORG}`
  await db`delete from teams where org_auth0_id = ${ORG}`
}

/** The stored team for an imported row, read straight from the column. */
const teamOf = async (email: string): Promise<string | null> =>
  (await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<{ team_id: string | null }[]>`
        select team_id from students where auth0_id = ${ORG} and email = ${email};
      `
    return rows?.[0]?.team_id ?? null
  })) ?? null

describeLiveDb('students import persists a team (live Postgres)', () => {
  useLiveTestDb({ seed, cleanup })

  test('a row with a team_id is filed under it', async () => {
    const validated = validateStudentRow({
      full_name: 'Imported With Team',
      email: 'imported-with-team@probe.local',
      team_id: TEAM_A,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(await teamOf('imported-with-team@probe.local')).toBe(TEAM_A)
  })

  test('a row with no team_id is still importable and stays unassigned', async () => {
    // The org-wide contract is preserved: an owner importing a roster before the
    // teams exist must not be blocked.
    const validated = validateStudentRow({
      full_name: 'Imported Teamless',
      email: 'imported-teamless@probe.local',
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(await teamOf('imported-teamless@probe.local')).toBeNull()
  })

  test('a malformed team_id fails that one row and the rest still import', async () => {
    const good = validateStudentRow({
      full_name: 'Good Row',
      email: 'imported-good@probe.local',
      team_id: TEAM_B,
    })
    const bad = validateStudentRow({
      full_name: 'Bad Row',
      email: 'imported-bad@probe.local',
      team_id: 'not-a-uuid',
    })
    expect(good.ok && bad.ok).toBe(true)
    if (!good.ok || !bad.ok) return

    const result = await importStudents(ORG, [{ cleaned: good.cleaned }, { cleaned: bad.cleaned }])
    expect(result.imported).toBe(1)
    expect(result.failed.map((f) => f.row_index)).toEqual([1])
    // The good row landed on its team; the bad one wrote nothing at all.
    expect(await teamOf('imported-good@probe.local')).toBe(TEAM_B)
    expect(await teamOf('imported-bad@probe.local')).toBeNull()
  })

  test('a row mixing dated columns and a team inserts each value into its own column', async () => {
    // The dynamic column list is built from the row's own keys, so the ORDER of
    // `cols` decides which positional placeholder each value lands in. Asserting
    // every differently-typed column is what proves the mapping, not merely that
    // an insert happened.
    const validated = validateStudentRow({
      full_name: 'Imported Full Row',
      email: 'imported-full@probe.local',
      jersey_number: '17',
      date_of_birth: '2008-04-01',
      joined_on: '2026-01-15',
      status: 'active',
      team_id: TEAM_A,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(await teamOf('imported-full@probe.local')).toBe(TEAM_A)

    const row = await withHistoryStoreOrThrow(async (db) => {
      const rows = await db<
        {
          jersey_number: number | null
          date_of_birth: Date | string | null
          joined_on: Date | string | null
        }[]
      >`
        select jersey_number, date_of_birth, joined_on
        from students where auth0_id = ${ORG} and email = ${'imported-full@probe.local'};
      `
      return rows?.[0] ?? null
    })
    expect(row?.jersey_number).toBe(17)
    expect(toIsoDay(row?.date_of_birth)).toBe('2008-04-01')
    expect(toIsoDay(row?.joined_on)).toBe('2026-01-15')
  })
})

/** Normalise a Postgres `date` column; Bun decodes `date` to `Date`. */
const toIsoDay = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}
