import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { validateStudentRow } from '../src/lib/orgValidate'

import { describeLiveDb, liveTestDbUrl } from './liveDb'
import { runProbeProcess } from './spawnProbe'

// ── The import's team column, against real Postgres ──────────────────────────
//
// `POST /students/import` gained a `team_id`, so a caller scoped to a team can
// no longer create players outside their roster (see routes/org/students.ts).
// The value has to survive the trip, and that is the part no fixture can check:
// `importStudents` builds `insert into students (auth0_id, <cols>)` from the
// cleaned row's own keys and binds positionally through `db.unsafe(sql, values)`
// with NO per-column casts, while the sibling `updateStudent` MUST carry
// explicit casts. studentImportTeamProbe.ts drives the real functions against
// real rows; this file spawns it in a fresh process and asserts the outcome.
//
// The subprocess is not ceremony. `tests/aiReportScope.test.ts` installs a
// process-global `mock.module('../src/lib/historyStore')`, Bun shares the module
// registry across test files, and any file sorting after it silently receives the
// mock: `withHistoryStore` returns null, the seed no-ops, and the assertions
// fail in ~0.2ms with no database error anywhere. These were green alone and red
// in the suite for exactly that reason.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'studentImportTeamProbe.ts')

type ProbeOut = {
  withTeam:
    { imported: number; failed: unknown[]; team: string | null } | { ok: false; reason: string }
  teamless:
    { imported: number; failed: unknown[]; team: string | null } | { ok: false; reason: string }
  malformed:
    | {
        imported: number
        failedIndexes: number[]
        goodTeam: string | null
        badTeam: string | null
      }
    | { ok: false; reason: string }
  mixedColumns:
    | {
        imported: number
        failed: unknown[]
        jersey: number | null
        dob: string | null
        joined: string | null
        team: string | null
      }
    | { ok: false; reason: string }
}

const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'

const runProbe = async (): Promise<ProbeOut> => {
  // Bounded by runProbeProcess rather than a bare Bun.spawn, so a wedged probe
  // costs this spawn's budget and reports the child's partial output instead of
  // surfacing as an opaque suite-level "timed out after 30000ms" with nothing.
  // See tests/spawnProbe.ts.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // This probe is a different shape from the hermetic ones: it runs the real
  // functions against real rows and does not install its own connection, so it
  // inherits DATABASE_URL from the environment. `liveTestDbUrl()` is the same
  // resolution the gate used, which is why they cannot disagree: CI gets the
  // ephemeral service, and a developer with only DATABASE_URL keeps live Neon.
  env.DATABASE_URL = liveTestDbUrl()
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  const last = proc.stdout.trim().split('\n').at(-1) ?? ''
  expect(last, `probe produced no result:\n${proc.stdout}\n${proc.stderr}`).not.toBe('')
  return JSON.parse(last) as ProbeOut
}

// Gated on the ephemeral database rather than DATABASE_URL, which is the live
// Neon URL that ci.yml deliberately leaves unset — the reason this suite skipped
// on every CI run. `liveTestDb.ts` resolves TEST_DATABASE_URL →
// PERF_DATABASE_URL → DATABASE_URL, live last.
describeLiveDb('students import persists a team (live Postgres)', () => {
  test('a row with a team_id is filed under it', async () => {
    const out = await runProbe()
    const result = out.withTeam
    if ('ok' in result) throw new Error(result.reason)
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.team).toBe(TEAM_A)
  }, 120000)

  test('a row with no team_id is still importable and stays unassigned', async () => {
    // The org-wide contract is preserved: an owner importing a roster before the
    // teams exist must not be blocked.
    const out = await runProbe()
    const result = out.teamless
    if ('ok' in result) throw new Error(result.reason)
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.team).toBeNull()
  }, 120000)

  test('a malformed team_id fails that one row and the rest still import', async () => {
    const out = await runProbe()
    const result = out.malformed
    if ('ok' in result) throw new Error(result.reason)
    expect(result.imported).toBe(1)
    expect(result.failedIndexes).toEqual([1])
    // The good row landed on its team; the bad one wrote nothing at all.
    expect(result.goodTeam).toBe(TEAM_B)
    expect(result.badTeam).toBeNull()
  }, 120000)

  test('a row mixing dated columns and a team inserts each value into its own column', async () => {
    const out = await runProbe()
    const result = out.mixedColumns
    if ('ok' in result) throw new Error(result.reason)
    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.team).toBe(TEAM_A)
    // A mis-ordered placeholder list would swap these across columns, so
    // asserting every one is what proves the mapping, not just the insert.
    expect(result.jersey).toBe(17)
    expect(result.dob).toBe('2008-04-01')
    expect(result.joined).toBe('2026-01-15')
  }, 120000)
})

describe('validateStudentRow passes team_id through untouched', () => {
  // Deliberately shape-only: this function has no org context, so it cannot and
  // must not decide whether the team exists or is in scope. The route owns both.
  test('a team_id string survives cleaning', () => {
    const result = validateStudentRow({ full_name: 'X', team_id: TEAM_A })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleaned.team_id).toBe(TEAM_A)
  })

  test('an empty team_id is dropped rather than inserted as an empty string', () => {
    // `importStudents` filters out `''` columns, but leaving it in `cleaned`
    // would also make the route's `cleaned.team_id ?? batchTeam` treat an
    // explicit blank as "the caller chose no team" rather than "use the default".
    const result = validateStudentRow({ full_name: 'X', team_id: '' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('team_id' in result.cleaned).toBe(false)
  })

  test('a non-string team_id is dropped, not stringified', () => {
    const result = validateStudentRow({
      full_name: 'X',
      team_id: 42 as unknown as string,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('team_id' in result.cleaned).toBe(false)
  })
})
