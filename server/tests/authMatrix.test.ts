import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

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
  total: number
}

const runProbe = (): ProbeResult => {
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

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `matrix probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult
}

describe('authorization matrix', () => {
  test(
    'every route × role matches the policy table with no uncovered routes',
    () => {
      const result = runProbe()
      // Floor, not an exact count: new routes add cases, never remove them.
      expect(result.total).toBeGreaterThan(1000)
      expect(result.uncovered).toEqual([])
      expect(result.failures).toEqual([])
      expect(result.failureCount).toBe(0)
    },
    300000,
  )
})
