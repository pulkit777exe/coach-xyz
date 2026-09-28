import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Student delete: transactional erasure, club history preserved ───────────
// Private rows (wellness, objectives, plans, team links) go with the student;
// analyses and player events stay with the club, unlinked. The student row is
// claimed for the org before anything it points at is touched, so a foreign
// id deletes nothing.
//
// Every case spawns a probe process: the hermetic route cases run the real
// route + real data layer against a fixture stub (studentDeleteProbe.ts), and
// the transaction cases run the real data layer against ephemeral Postgres
// (studentDeletePgProbe.ts, TEST_DATABASE_URL-gated). Probe processes are
// isolated from every other file's `mock.module` stubs, which share the
// suite's module cache — an in-process version of these tests fails or
// errors depending on which files ran first.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'studentDeleteProbe.ts')
const PG_PROBE = join(import.meta.dir, 'studentDeletePgProbe.ts')

const scrubbedEnv = (): Record<string, string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  return env
}

const runProbe = (probe: string, extraEnv: Record<string, string> = {}): unknown => {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, probe],
    cwd: SERVER_DIR,
    env: { ...scrubbedEnv(), ...extraEnv },
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
  result: { status: number; body: unknown }
  mutations: Array<{ sql: string; values: unknown[] }>
  audits: Array<{ sql: string; values: unknown[] }>
}

describe('DELETE /students/:id (probe)', () => {
  test('a malformed id is a 400 before any store write', () => {
    const { result, mutations } = runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'malformed',
    }) as RouteProbeResult
    expect(result.status).toBe(400)
    expect(mutations).toEqual([])
  })

  test('an out-of-scope coach gets 403 and nothing changes', () => {
    const { result, mutations, audits } = runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'out-of-scope',
    }) as RouteProbeResult
    expect(result.status).toBe(403)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })

  test('an in-scope delete audits player.deleted with the student name', () => {
    const { result, mutations, audits } = runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'in-scope',
    }) as RouteProbeResult
    expect(result.status).toBe(200)
    const tables = mutations.map((m) => m.sql)
    for (const table of [
      'wellness_checkins',
      'training_objectives',
      'training_plans',
      'team_memberships',
      'analysis_history',
      'player_events',
    ]) {
      expect(tables.some((sql) => sql.includes(table)), table).toBe(true)
    }
    expect(audits.length).toBe(1)
    expect(audits[0].sql).toBe('audit:player.deleted')
    expect(audits[0].values).toContain('Dele Temme')
  })

  test("another org's student id deletes nothing", () => {
    const { result, mutations, audits } = runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'foreign-org',
    }) as RouteProbeResult
    expect(result.status).toBe(404)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('deleteStudent against ephemeral Postgres (probe)', () => {
  test('private rows go, cross-org is refused, rollback holds', () => {
    const result = runProbe(PG_PROBE) as { done: string[] }
    expect(result.done).toEqual(['delete', 'foreign', 'rollback'])
  })
})
