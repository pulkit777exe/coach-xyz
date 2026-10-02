import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { getReport, listReports } from '../src/lib/org/reports'
import { listObjectives } from '../src/lib/org/objectives'
import { listTrainingPlans } from '../src/lib/org/plans'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Org team scope, layer 1: the real scope SQL against real rows ──────────────
// Split out of orgTeamScope.test.ts on purpose, and that split is load-bearing.
//
// Its sibling file runs every case through a `bun <probe>` subprocess. When both
// halves lived together, enabling the live block made every probe spawn in the
// file jump from ~300ms to exactly 10001ms — the bounded PROBE_TIMEOUT_MS —
// because the file then held a live Postgres pool that each `bun` child
// inherits and waits on. Ten files' worth of that once pushed the server job
// past its 25-minute timeout, so the gate fix had to be reverted (3128acd,
// f6b16fd). A local run never showed it: the machine is fast enough that the
// child finished inside the budget.
//
// So the rule this file encodes: a suite that mixes a live database with
// process-spawning probes has two coupled costs, and enabling the database half
// taxes the probe half. One concern per file, and a live-database suite that
// spawns nothing.

const ORG = 'auth0|org-team-scope-test'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a2'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b2'

const idsOf = (rows: unknown): string[] =>
  ((rows ?? []) as Array<{ id: string }>).map((r) => r.id).sort()

// Gated on the ephemeral database, not on DATABASE_URL — which is the live Neon
// URL that ci.yml deliberately leaves unset, and the reason these ten cases
// skipped on every CI run for as long as they sat in the sibling file.
describeLiveDb('scope SQL against live Postgres', () => {
  const seed = async (db: SQL) => {
    await db`delete from training_objectives where org_auth0_id = ${ORG}`
    await db`delete from training_plans where org_auth0_id = ${ORG}`
    await db`delete from reports where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
    await db`
      insert into students (id, auth0_id, full_name, team_id, status) values
        (${STUDENT_A}::uuid, ${ORG}, 'Scope A', ${TEAM_A}::uuid, 'active'),
        (${STUDENT_B}::uuid, ${ORG}, 'Scope B', ${TEAM_B}::uuid, 'active');
    `
    // Objectives: team-level for each team, a student-level one, an org-level one.
    await db`
      insert into training_objectives (org_auth0_id, team_id, student_id, title) values
        (${ORG}, ${TEAM_A}::uuid, null, 'objective team A'),
        (${ORG}, ${TEAM_B}::uuid, null, 'objective team B'),
        (${ORG}, null, ${STUDENT_A}::uuid, 'objective student A'),
        (${ORG}, null, null, 'objective org level');
    `
    await db`
      insert into training_plans (org_auth0_id, team_id, student_id, title) values
        (${ORG}, ${TEAM_A}::uuid, null, 'plan team A'),
        (${ORG}, ${TEAM_B}::uuid, null, 'plan team B'),
        (${ORG}, null, ${STUDENT_A}::uuid, 'plan student A'),
        (${ORG}, null, null, 'plan org level');
    `
    // reports carry no team_id — only a student, or none at all.
    await db`
      insert into reports (auth0_id, student_id, report_type, title) values
        (${ORG}, ${STUDENT_A}::uuid, 'progress', 'report A'),
        (${ORG}, ${STUDENT_B}::uuid, 'progress', 'report B'),
        (${ORG}, null, 'monthly', 'report org level');
    `
  }

  const cleanup = async (db: SQL) => {
    await db`delete from training_objectives where org_auth0_id = ${ORG}`
    await db`delete from training_plans where org_auth0_id = ${ORG}`
    await db`delete from reports where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
  }

  // Seeded once for the group: every scoped read below is a pure read. Passed as
  // parameters rather than as this file's own beforeAll/afterAll because Bun runs
  // hooks in registration order, so one call cannot be both first for setup and
  // last for teardown — see liveDb.ts.
  useLiveTestDb({ seed, cleanup })

  /** What team A's coach sees: { teamIds: [TEAM_A], studentIds: [STUDENT_A] }. */
  const coachA = { teamIds: [TEAM_A], studentIds: [STUDENT_A] }
  const noScope = undefined

  test('a team A coach lists only team A objectives — team B and org-level rows are absent', async () => {
    const rows = await listObjectives(ORG, { scope: coachA })
    expect(rows.map((r) => r.title).sort()).toEqual(['objective student A', 'objective team A'])
    expect(rows.every((r) => r.team_id === TEAM_A || r.student_id === STUDENT_A)).toBe(true)
  })

  test('a team-level objective (team_id set, student_id null) is visible to that team coach', async () => {
    const rows = await listObjectives(ORG, { scope: coachA })
    const teamLevel = rows.find((r) => r.title === 'objective team A')
    expect(teamLevel).toBeDefined()
    expect(teamLevel?.team_id).toBe(TEAM_A)
    expect(teamLevel?.student_id).toBeNull()
  })

  test('an unassigned coach sees no objective at all, not even the org-level row', async () => {
    const rows = await listObjectives(ORG, { scope: { teamIds: [], studentIds: [] } })
    expect(rows).toEqual([])
  })

  test('an org-wide reader sees every objective, team-level and org-level alike', async () => {
    const rows = await listObjectives(ORG, { scope: noScope })
    expect(rows.map((r) => r.title).sort()).toEqual([
      'objective org level',
      'objective student A',
      'objective team A',
      'objective team B',
    ])
  })

  test('the existing team_id/student_id/status query filters still compose with scope', async () => {
    const scoped = await listObjectives(ORG, { scope: coachA, teamId: TEAM_A })
    expect(scoped.map((r) => r.title)).toEqual(['objective team A'])
    // A filter that points outside the scope matches nothing, not everything.
    const outside = await listObjectives(ORG, { scope: coachA, teamId: TEAM_B })
    expect(outside).toEqual([])
    expect(idsOf(await listObjectives(ORG, { scope: noScope, status: 'active' })).length).toBe(4)
  })

  test('plans follow the same team_id-OR-student_id rule', async () => {
    expect((await listTrainingPlans(ORG, { scope: coachA })).map((r) => r.title).sort()).toEqual([
      'plan student A',
      'plan team A',
    ])
    expect(await listTrainingPlans(ORG, { scope: { teamIds: [], studentIds: [] } })).toEqual([])
    expect((await listTrainingPlans(ORG, { scope: noScope })).length).toBe(4)
    expect(
      (await listTrainingPlans(ORG, { scope: coachA, studentId: STUDENT_A })).map((r) => r.title),
    ).toEqual(['plan student A'])
  })

  test('reports scope purely on the visible student set (they carry no team_id)', async () => {
    expect(
      (await listReports(ORG, { visibleStudentIds: [STUDENT_A] })).map((r) => r.title),
    ).toEqual(['report A'])
    expect(await listReports(ORG, { visibleStudentIds: [] })).toEqual([])
    // A report with no student is org-level, so a scoped caller never sees it.
    expect(
      (await listReports(ORG, { visibleStudentIds: [STUDENT_A, STUDENT_B] }))
        .map((r) => r.title)
        .sort(),
    ).toEqual(['report A', 'report B'])
    // Unscoped stays org-wide — the analyst/medical path.
    expect((await listReports(ORG)).length).toBe(3)
  })

  test("a single-object read of another student's report is absent, not merely filtered later", async () => {
    const orgWide = await listReports(ORG)
    const teamB = orgWide.find((r) => r.student_id === STUDENT_B) as { id: string }
    expect(teamB).toBeDefined()
    expect(await getReport(ORG, teamB.id)).toBeTruthy()
    expect(await getReport(ORG, teamB.id, { visibleStudentIds: [STUDENT_A] })).toBeNull()
    expect(
      await getReport(ORG, teamB.id, { visibleStudentIds: [STUDENT_A, STUDENT_B] }),
    ).toBeTruthy()
  })
})
