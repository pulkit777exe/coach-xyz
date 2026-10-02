import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── students.team_id is the scope source of truth ───────────────────────────
// A `team_memberships` row without `students.team_id` leaves the player
// invisible to the team's coaches; a `team_id` without the row hides them
// from the roster. Every assignment path must write both halves.
//
// The cases run in a probe process (teamStudentLinkProbe.ts) against ephemeral
// Postgres: the real routes + real transaction, isolated from every other
// file's `mock.module` stubs, which share the suite's module cache, and bounded
// by runProbeProcess (see tests/spawnProbe.ts). The probe performs each
// scenario and throws on mismatch; a zero exit means all six passed
// (mutation-verified — the old split-brain path fails add + foreign).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'teamStudentLinkProbe.ts')

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('student team link (probe)', () => {
  test('all six link scenarios pass against ephemeral Postgres', async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )

    const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
    expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
    const result = lastJsonLine<{ done: string[] }>(proc.stdout)
    expect(result.done).toEqual(['add', 'foreign', 'remove', 'move', 'unassign', 'delete-team'])
  })
})
