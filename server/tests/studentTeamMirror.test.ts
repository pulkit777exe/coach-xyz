import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { withHistoryStoreOrThrow } from '../src/lib/historyStore'
import { listTeamMembers, setStudentTeam } from '../src/lib/teams'
import { createStudent, importStudents } from '../src/lib/org/students'
import { validateStudentRow } from '../src/lib/orgValidate'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Assigning a team writes BOTH halves, on every path that assigns one ──────
//
// `setStudentTeam`'s own comment states the invariant: `students.team_id` is the
// scope source of truth, and the `team_memberships` row is the roster mirror —
// "both halves are written here, never separately". Two reasons it matters, and
// they fail in opposite directions:
//
//   - `team_id` without the row: the player is VISIBLE to the team's coaches
//     (scope reads `students.team_id`) but INVISIBLE in the team roster, because
//     `listTeamMembers` reads `team_memberships`. That is the silent one — the
//     scope layer says the player is on the team while the team page omits them.
//   - the row without `team_id`: the player is on the roster and invisible to the
//     team's coaches. The mirror half of the same defect.
//
// `setStudentTeam` and `addTeamMember` were routed through the invariant.
// `createStudent` and `importStudents` were not: both accepted a `team_id` and
// wrote only the `students` column, so every player created or bulk-imported
// under a team landed in exactly the first state above.
//
// Read the assertions as "the roster agrees with the scope layer", which is the
// property a coach actually experiences.

const ORG = 'auth0|student-team-mirror'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'

/**
 * A fixed uuid is a GLOBAL resource: `…a1` is claimed by six in-process suites,
 * and the key is the primary key rather than the org, so a seed that only deletes
 * `where org_auth0_id = …` cannot see another org's residue — and a suite that
 * inserts one without deleting it poisons whichever file claims it next. Hence
 * delete-by-id first, in BOTH the seed and the cleanup, which also makes `reset()`
 * idempotent (the first version violated `teams_pkey` on its second call).
 * Asserted by tests/fixtureIdCollisions.test.ts.
 */
const dropFixtures = async (db: SQL) => {
  await db`delete from team_memberships where team_id in (${TEAM_A}::uuid, ${TEAM_B}::uuid)`
  await db`delete from students where auth0_id = ${ORG}`
  await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid)`
}

const seed = async (db: SQL) => {
  await dropFixtures(db)
  await db`
    insert into teams (id, org_auth0_id, name, sport) values
      (${TEAM_A}::uuid, ${ORG}, 'Mirror A', 'soccer'),
      (${TEAM_B}::uuid, ${ORG}, 'Mirror B', 'soccer');
  `
}

const cleanup = dropFixtures

/**
 * Per-test reset. `useLiveTestDb` registers `beforeAll`/`afterAll` for the WHOLE
 * describe, so its seed runs once and every test in here shares one slate — and
 * these assertions are absolute (`toHaveLength(1)`, `toEqual([])`). Without this
 * they accumulate: the teamless case reported a roster of 3 and looked like the
 * opposite bug. A shared beforeAll is right for a read-only suite and wrong for
 * one that asserts exact counts.
 */
const reset = async (): Promise<void> => {
  await withHistoryStoreOrThrow(cleanup)
  await withHistoryStoreOrThrow(seed)
}

const rosterOf = async (teamId: string): Promise<string[]> =>
  (await listTeamMembers(teamId))
    .map((m) => m.student_id)
    .filter((id): id is string => typeof id === 'string')
    .sort()

describeLiveDb('assigning a team writes the roster mirror too (live Postgres)', () => {
  useLiveTestDb({ seed, cleanup })

  test('createStudent under a team puts the player in that team roster', async () => {
    await reset()
    const created = await createStudent(ORG, {
      full_name: 'Created Under A',
      email: 'created-under-a@probe.local',
      team_id: TEAM_A,
    })
    expect(created?.team_id).toBe(TEAM_A)
    expect(created?.id).toBeTruthy()
    // The half that was missing.
    expect(await rosterOf(TEAM_A)).toEqual([created!.id])
  })

  test('importStudents under a team puts every row in that team roster', async () => {
    await reset()
    const rows = ['one', 'two'].map((n) => {
      const validated = validateStudentRow({
        full_name: `Imported ${n}`,
        email: `imported-${n}@probe.local`,
        team_id: TEAM_A,
      })
      if (!validated.ok) throw new Error(validated.reason)
      return { cleaned: validated.cleaned }
    })
    const result = await importStudents(ORG, rows)
    expect(result.imported).toBe(2)
    expect(result.failed).toEqual([])

    // Two mirror rows, not zero — and not two per row, which is the other way to
    // get this wrong.
    const roster = await rosterOf(TEAM_A)
    expect(roster).toHaveLength(2)
    expect(new Set(roster).size).toBe(2)
  })

  test('an import row with no team still stays off every roster', async () => {
    await reset()
    const validated = validateStudentRow({
      full_name: 'Imported Teamless',
      email: 'imported-teamless@probe.local',
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const result = await importStudents(ORG, [{ cleaned: validated.cleaned }])
    expect(result.imported).toBe(1)
    // The teamless case must NOT acquire a stray mirror row — a NULL team_id
    // has no team to mirror into, and inventing one would put an unassigned
    // player on a club-wide roster.
    expect(await rosterOf(TEAM_A)).toEqual([])
    expect(await rosterOf(TEAM_B)).toEqual([])
  })

  test('a mixed batch files each row under its own team', async () => {
    await reset()
    const build = (name: string, team?: string) => {
      const validated = validateStudentRow({
        full_name: name,
        email: `${name}@probe.local`,
        ...(team ? { team_id: team } : {}),
      })
      if (!validated.ok) throw new Error(validated.reason)
      return { cleaned: validated.cleaned }
    }
    const result = await importStudents(ORG, [
      build('mixed-a', TEAM_A),
      build('mixed-b', TEAM_B),
      build('mixed-none'),
    ])
    expect(result.imported).toBe(3)
    expect(result.failed).toEqual([])
    expect(await rosterOf(TEAM_A)).toHaveLength(1)
    expect(await rosterOf(TEAM_B)).toHaveLength(1)
  })

  test('re-importing the same row does not duplicate the mirror', async () => {
    await reset()
    // `importStudents` skips a duplicate email, so the second call writes nothing
    // — and therefore must not add a second membership row. Asserted because a
    // mirror inserted per call rather than per row would pass the count check
    // above and still double this.
    const validated = validateStudentRow({
      full_name: 'Once Only',
      email: 'once-only@probe.local',
      team_id: TEAM_A,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect((await importStudents(ORG, [{ cleaned: validated.cleaned }])).imported).toBe(1)
    const second = await importStudents(ORG, [{ cleaned: validated.cleaned }])
    expect(second.duplicates_skipped).toBe(1)
    expect(await rosterOf(TEAM_A)).toHaveLength(1)
  })

  test('setStudentTeam keeps the two halves in step on a later move', async () => {
    await reset()
    // The control: the existing invariant still holds, so the import path is the
    // only one that was missing it. Moving the player to B must leave A's roster
    // empty and B's holding exactly one row — the mirror is REPLACED, not added.
    const created = await createStudent(ORG, {
      full_name: 'Moves Teams',
      email: 'moves-teams@probe.local',
      team_id: TEAM_A,
    })
    expect(created?.id).toBeTruthy()
    expect(await rosterOf(TEAM_A)).toEqual([created!.id])

    const change = await setStudentTeam(ORG, created!.id, TEAM_B)
    expect(change?.student?.team_id).toBe(TEAM_B)
    expect(await rosterOf(TEAM_A)).toEqual([])
    expect(await rosterOf(TEAM_B)).toEqual([created!.id])
  })
})
