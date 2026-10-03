import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { describeLiveDb, liveTestDbUrl } from './liveDb'
import { runProbeProcess } from './spawnProbe'

// ── The wellness export fan-out, against real Postgres ───────────────────────
//
// `buildOrgExport` used `roster.map(student => listWellness(...))` on a roster
// capped at ORG_EXPORT_LIMITS.students (2000), so one export was up to 2000
// round trips: `Promise.all`'d, so not a stall, but 2000 deep against a `max: 5`
// pool, competing with live traffic for the same connections.
//
// The replacement is one `student_id = any(...)::uuid[]` read plus a client-side
// group-by. Three things about it are invisible to a fixture and are the reason
// this is a live probe:
//
//  - `uuidArrayLiteral`. Bun sends a raw JS array as comma-joined TEXT, so
//    `any($1::uuid[])` would die with 22P02. A stubbed `db` casts nothing.
//  - The per-student cap. `row_number() over (partition by student_id …)`, not a
//    `limit`: a limit on the outer query caps the ROSTER's rows instead, which
//    returns everything for the first student and nothing for the rest.
//  - Equivalence with the fan-out. The probe runs both and compares row for row,
//    so "the same bundle" is measured rather than argued from the SQL.
//
// A subprocess because `tests/aiReportScope.test.ts` installs a process-global
// `mock.module('../src/lib/historyStore')` that Bun's shared module registry
// hands to any file sorting after it — the seed then no-ops and the assertions
// fail in ~0.2ms with no database error anywhere.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'wellnessBatchProbe.ts')
/** Seeds ~1200 check-ins across 120 students, so it is not the ~900ms median. */
const PROBE_TIMEOUT_MS = 60_000

type ProbeOut = {
  students: number
  perStudentCap: number
  rowsBefore: number
  rowsAfter: number
  readsBefore: number
  readsAfter: number
  identical: boolean
  maxPerStudent: number
  totalCheckinsSeeded: number
  studentZeroSeeded: number
  studentZeroReturned: number
  emptyListReads: number
  duplicateIdsReads: number
  failures: string[]
}

let probeRun: Promise<ProbeOut> | null = null

const runProbe = (): Promise<ProbeOut> => {
  probeRun ??= (async () => {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    // The probe installs its own connection from TEST_DATABASE_URL and forces
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

describeLiveDb('the wellness export read is one round trip (live Postgres)', () => {
  test('every probe assertion held', async () => {
    const out = await runProbe()
    expect(out.failures).toEqual([])
  }, 120000)

  test('the batched read returns exactly what the per-student fan-out returned', async () => {
    const out = await runProbe()
    // Byte-for-byte, in the same order: the bundle's `wellness` array is this
    // array, so a reorder is a visible diff in an export a human reads.
    expect(out.identical).toBe(true)
    expect(out.rowsAfter).toBe(out.rowsBefore)
    expect(out.rowsBefore).toBeGreaterThan(0)
  }, 120000)

  test('120 students cost 1 read instead of 120', async () => {
    const out = await runProbe()
    expect(out.readsAfter).toBe(1)
    // The before-count is asserted too, so this is a measured delta rather than
    // a claim about code that is no longer there.
    expect(out.readsBefore).toBe(out.students)
  }, 120000)

  test('the cap is per student, not per roster', async () => {
    const out = await runProbe()
    // Student 0 was seeded with MORE than the cap, precisely so a cap that
    // leaked — a `distinct on`, or a `limit` on the outer query, which caps the
    // roster's rows rather than each student's — would return all of them.
    expect(out.studentZeroSeeded).toBeGreaterThan(out.perStudentCap)
    expect(out.studentZeroReturned).toBe(out.perStudentCap)
    // And no student anywhere came back over the cap.
    expect(out.maxPerStudent).toBe(out.perStudentCap)
  }, 120000)

  test('an empty id list spends no query at all', async () => {
    const out = await runProbe()
    expect(out.emptyListReads).toBe(0)
  }, 120000)

  test('a duplicated id list is one read and does not double the rows', async () => {
    const out = await runProbe()
    expect(out.duplicateIdsReads).toBe(1)
  }, 120000)
})
