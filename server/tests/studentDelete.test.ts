import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

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
// errors depending on which files ran first — and each spawn is bounded by
// runProbeProcess so a wedged child is a probe failure (tests/spawnProbe.ts).

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

const runProbe = async (probe: string, extraEnv: Record<string, string> = {}): Promise<unknown> => {
  const proc = await runProbeProcess({
    probe,
    cwd: SERVER_DIR,
    env: { ...scrubbedEnv(), ...extraEnv },
  })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<unknown>(proc.stdout)
}

type RouteProbeResult = {
  result: { status: number; body: unknown }
  mutations: Array<{ sql: string; values: unknown[] }>
  audits: Array<{ sql: string; values: unknown[] }>
}

describe('DELETE /students/:id (probe)', () => {
  test('a malformed id is a 400 before any store write', async () => {
    const { result, mutations } = (await runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'malformed',
    })) as RouteProbeResult
    expect(result.status).toBe(400)
    expect(mutations).toEqual([])
  })

  test('an out-of-scope coach gets 403 and nothing changes', async () => {
    const { result, mutations, audits } = (await runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'out-of-scope',
    })) as RouteProbeResult
    expect(result.status).toBe(403)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })

  test('an in-scope delete audits player.deleted with the student name', async () => {
    const { result, mutations, audits } = (await runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'in-scope',
    })) as RouteProbeResult
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
      expect(
        tables.some((sql) => sql.includes(table)),
        table,
      ).toBe(true)
    }
    expect(audits.length).toBe(1)
    expect(audits[0].sql).toBe('audit:player.deleted')
    expect(audits[0].values).toContain('Dele Temme')
  })

  test("another org's student id deletes nothing", async () => {
    const { result, mutations, audits } = (await runProbe(PROBE, {
      STUDENT_DELETE_CASE: 'foreign-org',
    })) as RouteProbeResult
    expect(result.status).toBe(404)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('deleteStudent against ephemeral Postgres (probe)', () => {
  test('private rows go, cross-org is refused, rollback holds', async () => {
    const result = (await runProbe(PG_PROBE)) as { done: string[] }
    expect(result.done).toEqual(['delete', 'foreign', 'rollback'])
  })
})
