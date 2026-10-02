// Live-Postgres probe for the students-import team column.
//
// WHY A SUBPROCESS: `tests/aiReportScope.test.ts` installs a process-global
// `mock.module('../src/lib/historyStore')`, and Bun's module registry is shared
// across test files in one run. Any file that sorts after it therefore gets the
// MOCK, not the real store — `withHistoryStore` returns null, the seed silently
// no-ops, and the assertions fail in ~0.2ms with no database error anywhere.
// That is what this file hit: green alone, red in the suite, in an order that
// had nothing to do with the code under test. Eight other suites already solve
// it the same way (studentScopeProbe, accountTreeScopeProbe, …); this one joins
// them. Nothing is mocked here on purpose — the point is the real SQL.
//
// WHAT IS REAL HERE: `importStudents` and `validateStudentRow`, i.e. the dynamic
// `insert into students (auth0_id, <cols>)` built from the cleaned row's own keys
// and bound positionally through `db.unsafe(sql, values)` with NO per-column
// casts. Postgres infers each parameter from the target column of an INSERT
// ... VALUES, so a JS string into the `team_id` uuid column is fine — while the
// sibling `updateStudent` MUST carry explicit casts, because a SET assignment
// gives Postgres nothing to infer from. Two sibling builders, two different cast
// requirements, and nothing but a live row distinguishes them.

import type { SQL } from 'bun'

import { withHistoryStore } from '../src/lib/historyStore'
import { importStudents } from '../src/lib/org/students'
import { validateStudentRow } from '../src/lib/orgValidate'

const ORG = 'auth0|import-team-probe'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'

// Clean on the primary key as well as the scoping column. These fixture uuids
// are deliberately memorable and therefore SHARED across probes: `a1` is
// TEAM_A here, TEAM_A in teamStudentLinkProbe (org `auth0|link-org`) and
// STUDENT_A in attendancePerformanceScopeProbe (org `auth0|org-owner`). A probe
// that deletes only `where org_auth0_id = <its own org>` therefore cannot see the
// row another probe left under a different org, and the next insert dies with
// `duplicate key value violates unique constraint "teams_pkey"` — a failure that
// depends on which probe ran first, i.e. on readdir order. Deleting by id makes
// the seed correct regardless of what ran before it. Bun runs test files
// sequentially, so removing another probe's fixture row here is safe: each one
// re-seeds what it needs.
const seed = async (db: SQL) => {
  await db`delete from students where auth0_id = ${ORG}`
  await db`delete from teams where id = ${TEAM_A}::uuid or id = ${TEAM_B}::uuid or org_auth0_id = ${ORG}`
  await db`
    insert into teams (id, org_auth0_id, name, sport) values
      (${TEAM_A}::uuid, ${ORG}, 'Import Team A', 'soccer'),
      (${TEAM_B}::uuid, ${ORG}, 'Import Team B', 'soccer');
  `
}

const cleanup = async (db: SQL) => {
  await db`delete from students where auth0_id = ${ORG}`
  await db`delete from teams where id = ${TEAM_A}::uuid or id = ${TEAM_B}::uuid or org_auth0_id = ${ORG}`
}

const withSeeded = async <T>(fn: () => Promise<T>): Promise<T> => {
  const seeded = await withHistoryStore(seed)
  // orThrow semantics on purpose: a null here means the store is unreachable,
  // and swallowing it would turn "no database" into a green assertion about a
  // row that was never written.
  if (seeded === null) throw new Error('live seed failed — is DATABASE_URL reachable?')
  try {
    return await fn()
  } finally {
    await withHistoryStore(cleanup)
  }
}

const teamOf = async (email: string): Promise<string | null> =>
  (await withHistoryStore(async (db) => {
    const rows = await db<{ team_id: string | null }[]>`
      select team_id from students where auth0_id = ${ORG} and email = ${email};
    `
    return rows?.[0]?.team_id ?? null
  })) ?? null

/** Normalise a Postgres `date` column to `YYYY-MM-DD`. Bun decodes `date` to Date. */
const toIsoDay = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

const out: Record<string, unknown> = {}

// 1. A row with a team_id is filed under it.
out.withTeam = await withSeeded(async () => {
  const validated = validateStudentRow({
    full_name: 'Imported With Team',
    email: 'imported-with-team@probe.local',
    team_id: TEAM_A,
  })
  if (!validated.ok) return { ok: false as const, reason: validated.reason }
  const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
  return {
    imported: result.imported,
    failed: result.failed,
    team: await teamOf('imported-with-team@probe.local'),
  }
})

// 2. The org-wide contract survives: no team is still importable, and lands
//    unassigned. An owner importing a roster before the teams exist must work.
out.teamless = await withSeeded(async () => {
  const validated = validateStudentRow({
    full_name: 'Imported Teamless',
    email: 'imported-teamless@probe.local',
  })
  if (!validated.ok) return { ok: false as const, reason: validated.reason }
  const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
  return {
    imported: result.imported,
    failed: result.failed,
    team: await teamOf('imported-teamless@probe.local'),
  }
})

// 3. A malformed team_id fails that ONE row; the rest of the batch still lands.
//    `importStudents` catches per row and pushes err.message — only because it
//    catches, so assert the outcome rather than the mechanism.
out.malformed = await withSeeded(async () => {
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
  if (!good.ok || !bad.ok) return { ok: false as const, reason: 'validator rejected' }
  const result = await importStudents(ORG, [{ cleaned: good.cleaned }, { cleaned: bad.cleaned }])
  return {
    imported: result.imported,
    failedIndexes: result.failed.map((f) => f.row_index),
    goodTeam: await teamOf('imported-good@probe.local'),
    badTeam: await teamOf('imported-bad@probe.local'),
  }
})

// 4. The dynamic column list is built from the row's own keys, so the ORDER of
//    `cols` decides which positional placeholder each value lands in. Asserting
//    every differently-typed column is what proves the mapping, not merely that
//    an insert happened.
out.mixedColumns = await withSeeded(async () => {
  const validated = validateStudentRow({
    full_name: 'Imported Full Row',
    email: 'imported-full@probe.local',
    jersey_number: '17',
    date_of_birth: '2008-04-01',
    joined_on: '2026-01-15',
    status: 'active',
    team_id: TEAM_A,
  })
  if (!validated.ok) return { ok: false as const, reason: validated.reason }
  const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
  const row = await withHistoryStore(async (db) => {
    const rows = await db<
      {
        jersey_number: number | null
        date_of_birth: Date | string | null
        joined_on: Date | string | null
        team_id: string | null
      }[]
    >`
      select jersey_number, date_of_birth, joined_on, team_id
      from students
      where auth0_id = ${ORG} and email = ${'imported-full@probe.local'};
    `
    return rows?.[0] ?? null
  })
  return {
    imported: result.imported,
    failed: result.failed,
    jersey: row?.jersey_number ?? null,
    dob: toIsoDay(row?.date_of_birth),
    joined: toIsoDay(row?.joined_on),
    team: row?.team_id ?? null,
  }
})

console.log(JSON.stringify(out))
