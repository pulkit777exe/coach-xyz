import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Org data rights: export + privacy review queue ──────────────────────────
// Owner/admin-only. The export ships bounded JSON/CSV sections (wellness only
// for `medical.read`); privacy requests stay recorded until a human moves
// them received → in_progress → completed | declined, and deletion executes
// only from in_progress via an explicit action. Every case spawns a probe
// process, isolated from other files' `mock.module` stubs:
// - dataRightsProbe.ts: floors, formats, queue scoping, transitions, guards.
// - dataRightsPgProbe.ts: execute-delete end to end on ephemeral Postgres.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'dataRightsProbe.ts')
const PG_PROBE = join(import.meta.dir, 'dataRightsPgProbe.ts')

const runProbe = (probe: string, extraEnv: Record<string, string>): unknown => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  const proc = Bun.spawnSync({
    cmd: [process.execPath, probe],
    cwd: SERVER_DIR,
    env: { ...env, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as unknown
}

type RouteProbeResult = {
  results: Array<{ name: string; status: number; extra?: Record<string, unknown> }>
  audits: Array<unknown>
}

const runRoutesProbe = (probeCase: string): RouteProbeResult =>
  runProbe(PROBE, { DATARIGHTS_CASE: probeCase }) as RouteProbeResult

const statusOf = (result: RouteProbeResult, name: string): number => {
  const entry = result.results.find((r) => r.name === name)
  expect(entry, `no result named ${name}`).toBeDefined()
  return entry?.status ?? -1
}

describe('org data rights (probe)', () => {
  test('coaches are refused on every data-rights route', () => {
    const result = runRoutesProbe('floor')
    for (const name of ['export', 'queue', 'patch', 'execute']) {
      expect(statusOf(result, name), name).toBe(403)
    }
  })

  test('export answers versioned JSON and BOM CSV, audited', () => {
    const result = runRoutesProbe('export')
    expect(statusOf(result, 'json')).toBe(200)
    expect(statusOf(result, 'bad-format')).toBe(400)
    expect(statusOf(result, 'bad-section')).toBe(400)
    expect(statusOf(result, 'csv')).toBe(200)
    const csv = result.results.find((r) => r.name === 'csv')
    expect(csv?.extra?.contentType).toContain('text/csv')
    expect(csv?.extra?.head).toContain('id,full_name')
    // Both successful exports audited.
    expect(result.audits.filter((a) => a === 'report.exported').length).toBe(2)
  })

  test('a foreign request is 404 in this org queue', () => {
    const result = runRoutesProbe('queue')
    expect(statusOf(result, 'foreign-patch')).toBe(404)
    expect(statusOf(result, 'list')).toBe(200)
    const list = result.results.find((r) => r.name === 'list')
    expect(list?.extra).toEqual([
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000e2',
    ])
  })

  test('status transitions enforce the review order', () => {
    const result = runRoutesProbe('transitions')
    expect(statusOf(result, 'skip')).toBe(422)
    expect(statusOf(result, 'start')).toBe(200)
    expect(statusOf(result, 'bad-value')).toBe(400)
  })

  test('execution needs a delete in in_progress', () => {
    const result = runRoutesProbe('execute-guards')
    expect(statusOf(result, 'wrong-type')).toBe(400)
    expect(statusOf(result, 'too-early')).toBe(422)
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('privacy execute-delete (probe)', () => {
  test('one human click erases every trace and completes the request', () => {
    const out = runProbe(PG_PROBE, {}) as { executed: boolean }
    expect(out.executed).toBe(true)
  })
})
