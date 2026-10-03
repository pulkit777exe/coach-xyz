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
// scenario and throws on mismatch; a zero exit means all of them passed
// (mutation-verified — the old split-brain path fails add + foreign, and the
// loose-link paths fail foreign-member + foreign-delete).
//
// Live Postgres rather than a fixture store is what makes the last three cases
// mean anything: `addTeamMember`'s membership predicate and `removeTeamMember`'s
// `team_id`-only delete are exactly the SQL that no stub of `db` can observe.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'teamStudentLinkProbe.ts')

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('student team link (probe)', () => {
  test('every link and roster scenario passes against ephemeral Postgres', async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )

    const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
    expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
    const result = lastJsonLine<{ done: string[] }>(proc.stdout)
    expect(result.done).toEqual([
      'add',
      'foreign',
      'remove',
      'move',
      'unassign',
      'delete-team',
      'foreign-member',
      'own-member',
      'foreign-delete',
    ])
  })
})
