import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'
import { MATRIX } from './authMatrixPolicy'

// ── Authorization matrix ─────────────────────────────────────────────────────
// Every non-capability route × every role, driven against the real composed
// app (buildApp) with a fixture store. The policy table
// (tests/authMatrixPolicy.ts) is the checked-in contract: anonymous, owner,
// admin, head_coach, coach, assistant_coach, analyst, medical, player,
// outsider (verified, no membership), and other (member of another org).
//
// Conventions pinned here: reads of hidden students → 404, writes → 403;
// missing capability → 403; malformed ids → 400. Routes without a policy
// entry (and not in MATRIX_EXCLUDED) fail the run, so a new route without a
// row is a red test, not a silent gap.
//
// The probe (authMatrixProbe.ts) runs in a fresh Bun process so its
// `mock.module` store/identity stubs cannot leak into the rest of the
// suite's shared module cache (see AGENTS.md). It keeps the real guard,
// caller, permissions, and scope seam, so a passing case proves the route's
// own checks agreed with the matrix instead of a hard-coded stub.
//
// Found by this suite while building it: the global serviceGuard's `body`
// destructure forced an app-wide body parse that consumed the request
// stream, so every handler reading it itself (scan-video formData, both
// analyze kickoffs, invite-accept) threw "Body already used" in the
// composed app while standalone mounts passed. The guard no longer
// references `body`; POST /api/auth/sync enforces body.sub in its handler.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'authMatrixProbe.ts')

type ProbeResult = {
  failures: Array<{
    route: string
    role: string
    variant?: string
    expected: number
    got: number | string
  }>
  failureCount: number
  uncovered: string[]
  /** Policy rows matching no registered route — expectations nothing can run. */
  orphanEntries: string[]
  total: number
}

const runProbe = async (): Promise<ProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  // Scrub identity + connectivity: the probe sets its own SERVICE_TOKEN and
  // must never touch a real database, engine, or Redis quota.
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ENGINE_URL = ''
  delete env.MATRIX_ONLY
  delete env.MATRIX_TRACE

  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `matrix probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<ProbeResult>(proc.stdout)
}

describe('authorization matrix', () => {
  test('no two entries share a method+path, so no row can be dead', () => {
    // The probe resolves one entry per route with `MATRIX.find(...)`, which returns
    // the FIRST match. A duplicated method+path therefore disables the second copy's
    // cases silently — `uncovered` stays empty because the path IS covered, and
    // `orphanEntries` stays empty because it only looks for paths no route serves.
    // This file had exactly that: `GET /api/me/notifications` declared twice, 11 dead
    // cases, no signal. Found only by noticing the probe's `total` was 11 short of
    // the table's own arithmetic — which is the general lesson, and the reason this
    // asserts both numbers agree rather than only that they are plausible.
    const seen = new Map<string, number>()
    for (const entry of MATRIX) {
      const key = `${entry.method} ${entry.path}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(duplicates).toEqual([])
    expect(MATRIX.length).toBe(seen.size)
  })

  test("the table's own arithmetic equals the number of cases the probe runs", async () => {
    // The duplicate above hid behind this mismatch: 1507 expected, 1496 run. A
    // count that disagrees with the count is the only cheap signal that some row is
    // being skipped, so it is asserted rather than eyeballed.
    const result = await runProbe()
    const declared = MATRIX.reduce(
      (n, e) =>
        n +
        Object.keys(e.expect).length +
        (e.variants ?? []).reduce((m, v) => m + Object.keys(v.expect).length, 0),
      0,
    )
    expect(result.total).toBe(declared)
  }, 300000)

  test('every route × role matches the policy table with no uncovered routes', async () => {
    const result = await runProbe()
    // Floor, not an exact count: new routes add cases, never remove them.
    expect(result.total).toBeGreaterThan(1000)
    expect(result.uncovered).toEqual([])
    // The other direction. The probe drives cases from the app's ROUTE list, so
    // a row for a path no route serves is never visited — an expectation nobody
    // executes reads exactly like a satisfied one, which is how a row came to
    // pin 201 for `POST /api/org/:auth0Id/performance` (no such route; the write
    // is `POST /students/:id/performance`). Deleting or renaming a route must
    // delete or rename its row too.
    expect(result.orphanEntries).toEqual([])
    expect(result.failures).toEqual([])
    expect(result.failureCount).toBe(0)
  }, 300000)
})
