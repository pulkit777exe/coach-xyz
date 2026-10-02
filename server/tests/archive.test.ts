import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Archive status ──────────────────────────────────────────────────────────
// `archived` hides students from the default roster while scope, by-id reads
// and history keep resolving them. Both probes spawn fresh processes,
// isolated from other files' `mock.module` stubs and bounded by
// runProbeProcess (see tests/spawnProbe.ts):
// - archiveProbe.ts: the archive predicate binds correctly per option shape
//   (located by placeholder position, never by value type).
// - archivePgProbe.ts: the CHECK migration against ephemeral Postgres.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'archiveProbe.ts')
const PG_PROBE = join(import.meta.dir, 'archivePgProbe.ts')

const runProbe = async (probe: string): Promise<unknown> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  const proc = await runProbeProcess({ probe, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<unknown>(proc.stdout)
}

describe('student archive (probe)', () => {
  test('the default roster hides archived, options override, status wins', async () => {
    const out = (await runProbe(PROBE)) as {
      defaultHide: unknown
      includeShows: unknown
      statusWinsHide: unknown
      statusWinsValue: unknown
      explicitActiveHide: unknown
    }
    expect(out.defaultHide).toBe(true)
    expect(out.includeShows).toBe(false)
    // An explicit status filter wins over the default (and over the flag).
    expect(out.statusWinsHide).toBe(false)
    expect(out.statusWinsValue).toBe('archived')
    expect(out.explicitActiveHide).toBe(false)
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('students status CHECK migration (probe)', () => {
  test('the old three-value check migrates and archived rows persist', async () => {
    const out = (await runProbe(PG_PROBE)) as { migrated: boolean }
    expect(out.migrated).toBe(true)
  })
})
