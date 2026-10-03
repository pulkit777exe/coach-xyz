import { beforeEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  createTrainingPlan,
  deleteTrainingPlan,
  getTrainingPlan,
  listTrainingPlans,
  planVisibleTo,
  setTrainingPlanStatus,
} from '../src/lib/org/plans'
import type { StudentScope } from '../src/lib/org/scope'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Training plans: the write path, and the three-way row shape ──────────────
//
// A `training_plans` row is one of three things: team-level (team_id set,
// student_id null), student-level (student_id set) or ORG-level (both null).
// That is the whole reason this module's read rule exists — checking one column
// would hide a team-level plan from its own team's coach, or leak a student-level
// plan to a coach who merely shares the team.
//
// The uncovered half is `createTrainingPlan` / `setTrainingPlanStatus` /
// `deleteTrainingPlan` and the `planVisibleTo` truth table, plus the scope
// branches of `listTrainingPlans`. Two of them are guards that only a live
// Postgres can observe:
//
//   • `createTrainingPlan` validates through `getStudent` / `getTeam`, which are
//     org-scoped — so a student from another org returns null and the plan is
//     refused. That is a cross-tenant check, and it is invisible to a stub.
//   • `listTrainingPlans` binds BOTH id lists through `uuidArrayLiteral`. A raw
//     JS array reaches Postgres as comma-joined text and the `::uuid[]` cast
//     fails with 22P02, which is exactly what a scoped (non-org-wide) read does.
//
// Live Postgres, and this file spawns nothing — see the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file.

const ORG = 'auth0|planslive-org'
const OTHER = 'auth0|planslive-other'
const TEAM_A = '9c7e0001-0000-4000-8000-0000000000a1'
const TEAM_B = '9c7e0001-0000-4000-8000-0000000000a2'
const OTHER_TEAM = '9c7e0001-0000-4000-8000-0000000000b1'
const ALICE = '9c7e0001-0000-4000-8000-0000000000c1'
const BOB = '9c7e0001-0000-4000-8000-0000000000c2'
const OTHER_STUDENT = '9c7e0001-0000-4000-8000-0000000000d1'

let db: SQL | null = null

const resetRows = async (conn: SQL) => {
  await conn`delete from training_plans where org_auth0_id = ${ORG} or org_auth0_id = ${OTHER}`
  await conn`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${OTHER_TEAM}::uuid)`
  await conn`
    insert into teams (id, org_auth0_id, name, sport)
    values
      (${TEAM_A}::uuid, ${ORG}, 'Team A', 'basketball'),
      (${TEAM_B}::uuid, ${ORG}, 'Team B', 'basketball'),
      (${OTHER_TEAM}::uuid, ${OTHER}, 'Foreign team', 'soccer');
  `
  await conn`delete from students where id in (${ALICE}::uuid, ${BOB}::uuid, ${OTHER_STUDENT}::uuid)`
  await conn`
    insert into students (id, auth0_id, full_name, status)
    values
      (${ALICE}::uuid, ${ORG}, 'Alice', 'active'),
      (${BOB}::uuid, ${ORG}, 'Bob', 'active'),
      (${OTHER_STUDENT}::uuid, ${OTHER}, 'Foreign', 'active');
  `
  await conn`
    insert into training_plans (org_auth0_id, team_id, student_id, title, description, status, created_by)
    values
      (${ORG}, null,             null,        'Club plan',    'Everyone',   'active', ${ORG}),
      (${ORG}, ${TEAM_A}::uuid,  null,        'Team A plan',  'Team A',     'active', ${ORG}),
      (${ORG}, ${TEAM_B}::uuid,  null,        'Team B plan',  'Team B',     'active', ${ORG}),
      (${ORG}, null,             ${ALICE}::uuid, 'Alice plan', 'Alice only',  'done',   ${ORG}),
      (${ORG}, null,             ${BOB}::uuid,   'Bob plan',   'Bob only',    'active', ${ORG}),
      (${OTHER}, null,          null,         'Foreign plan', null,          'active', ${OTHER});
  `
}

const titles = (rows: { title: string }[]): string[] => rows.map((r) => r.title).sort()

const scoped = (teamIds: string[]): StudentScope => ({ all: false, teamIds })

describeLiveDb('training_plans: three row shapes, and the scoped read rule', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await conn`delete from training_plans where org_auth0_id = ${ORG} or org_auth0_id = ${OTHER}`
      await conn`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${OTHER_TEAM}::uuid)`
      await conn`delete from students where id in (${ALICE}::uuid, ${BOB}::uuid, ${OTHER_STUDENT}::uuid)`
    },
  })

  beforeEach(async () => {
    await resetRows(db!)
  })

  // ── planVisibleTo: the pure half, so the list filter and the write-path
  //    refusal can never disagree. Cheap enough to pin exhaustively.
  describe('planVisibleTo', () => {
    test('an org-wide scope sees every row shape', () => {
      const all: StudentScope = { all: true }
      expect(planVisibleTo(all, null, { team_id: TEAM_A, student_id: ALICE })).toBe(true)
      expect(planVisibleTo(all, null, { team_id: null, student_id: null })).toBe(true)
      expect(planVisibleTo(all, [], { team_id: null, student_id: ALICE })).toBe(true)
    })

    test('a scoped caller sees its own team and its own students', () => {
      expect(planVisibleTo(scoped([TEAM_A]), [ALICE], { team_id: TEAM_A, student_id: null })).toBe(true)
      expect(planVisibleTo(scoped([TEAM_A]), [ALICE], { team_id: null, student_id: ALICE })).toBe(true)
    })

    test('another team\'s plan and another student\'s plan are both refused', () => {
      expect(planVisibleTo(scoped([TEAM_A]), [ALICE], { team_id: TEAM_B, student_id: null })).toBe(
        false,
      )
      expect(planVisibleTo(scoped([TEAM_A]), [ALICE], { team_id: null, student_id: BOB })).toBe(false)
    })

    test('an ORG-level row (both columns null) is org-owned: no scoped caller touches it', () => {
      // A row with no team and no student is nobody's but the org's. Guarding on
      // "team_id is not one of mine" would pass vacuously here.
      expect(planVisibleTo(scoped([TEAM_A]), [ALICE], { team_id: null, student_id: null })).toBe(false)
      expect(planVisibleTo(scoped([]), [], { team_id: null, student_id: null })).toBe(false)
    })

    test('a null student list means org-wide, so an org-wide caller is not refused', () => {
      // `null` is what visibleStudentIds returns for an unscoped caller; treating
      // it as an empty list would refuse the owner their own student's plan.
      expect(planVisibleTo(scoped([TEAM_A]), null, { team_id: null, student_id: ALICE })).toBe(true)
    })
  })

  test('an unscoped list sees every plan in the org, team and student and club alike', async () => {
    expect(titles(await listTrainingPlans(ORG))).toEqual([
      'Alice plan',
      'Bob plan',
      'Club plan',
      'Team A plan',
      'Team B plan',
    ])
  })

  test('the list is org-scoped', async () => {
    expect(titles(await listTrainingPlans(ORG)).some((t) => t.includes('Foreign'))).toBe(false)
    expect(titles(await listTrainingPlans(OTHER))).toEqual(['Foreign plan'])
  })

  test('a scope of teamIds matches team rows AND student rows of visible students', async () => {
    // The union the SQL expresses: `team_id = any(...) or student_id = any(...)`.
    // Checking one column only would either hide Team A's own plan or leak Bob's.
    const rows = await listTrainingPlans(ORG, {
      scope: { teamIds: [TEAM_A], studentIds: [ALICE] },
    })
    expect(titles(rows)).toEqual(['Alice plan', 'Team A plan'])
  })

  test('a scope with an empty team list still matches student rows', async () => {
    // Both params bind NULL when their list is empty, and `coalesce(... , false)`
    // is what keeps "no teams" from reading as "no scope".
    const rows = await listTrainingPlans(ORG, { scope: { teamIds: [], studentIds: [BOB] } })
    expect(titles(rows)).toEqual(['Bob plan'])
  })

  test('an unassigned coach (both lists empty) matches NOTHING — not even the club plan', async () => {
    expect(await listTrainingPlans(ORG, { scope: { teamIds: [], studentIds: [] } })).toEqual([])
  })

  test('teamId and studentId narrow further, and compose with the scope', async () => {
    expect(titles(await listTrainingPlans(ORG, { teamId: TEAM_B }))).toEqual(['Team B plan'])
    expect(titles(await listTrainingPlans(ORG, { studentId: BOB }))).toEqual(['Bob plan'])
    expect(
      titles(await listTrainingPlans(ORG, { teamId: TEAM_A, studentId: ALICE })),
    ).toEqual([])
    // A scope that excludes the row must win even when the explicit filter names it.
    expect(
      await listTrainingPlans(ORG, {
        teamId: TEAM_B,
        scope: { teamIds: [TEAM_A], studentIds: [] },
      }),
    ).toEqual([])
  })

  test('limit is clamped', async () => {
    expect((await listTrainingPlans(ORG, { limit: 0 })).length).toBe(1)
    expect((await listTrainingPlans(ORG, { limit: 2 })).length).toBe(2)
    expect((await listTrainingPlans(ORG, { limit: 999_999 })).length).toBe(5)
  })

  test('getTrainingPlan is unscoped by id but org-owned, and misses cleanly', async () => {
    const club = (await listTrainingPlans(ORG)).find((r) => r.title === 'Club plan')!
    expect((await getTrainingPlan(ORG, club.id))?.title).toBe('Club plan')
    expect(await getTrainingPlan(OTHER, club.id)).toBeNull()
    expect(await getTrainingPlan(ORG, '9c7e0001-0000-4000-8000-0000000000ff')).toBeNull()
  })

  test('createTrainingPlan trims and truncates the title, and nulls an empty description', async () => {
    const created = await createTrainingPlan(ORG, 'auth0|creator', {
      title: `   ${'x'.repeat(240)}   `,
      description: '   ',
    })
    expect(created).not.toBeNull()
    expect(created!.title.length).toBe(200)
    expect(created!.description).toBeNull()
    expect(created!.created_by).toBe('auth0|creator')
    expect(created!.status).toBe('active')
    expect(created!.team_id).toBeNull()
    expect(created!.student_id).toBeNull()
  })

  test('createTrainingPlan refuses a blank title without touching the store', async () => {
    const before = (await listTrainingPlans(ORG)).length
    expect(await createTrainingPlan(ORG, null, { title: '   ' })).toBeNull()
    expect((await listTrainingPlans(ORG)).length).toBe(before)
  })

  test('createTrainingPlan refuses a student that is not in this org', async () => {
    // The cross-tenant guard: getStudent is org-scoped, so a foreign student id
    // returns null and the plan is never written.
    expect(await createTrainingPlan(ORG, null, { title: 'Foreign student', student_id: OTHER_STUDENT })).toBeNull()
    expect(await createTrainingPlan(ORG, null, { title: 'No such student', student_id: '9c7e0001-0000-4000-8000-0000000000ee' })).toBeNull()
    expect(titles(await listTrainingPlans(ORG))).not.toContain('Foreign student')
  })

  test('createTrainingPlan refuses a team that is not in this org', async () => {
    expect(await createTrainingPlan(ORG, null, { title: 'Foreign team', team_id: OTHER_TEAM })).toBeNull()
    expect(await createTrainingPlan(ORG, null, { title: 'No such team', team_id: '9c7e0001-0000-4000-8000-0000000000ee' })).toBeNull()
  })

  test('createTrainingPlan accepts a team row, a student row, and one of each', async () => {
    const teamPlan = await createTrainingPlan(ORG, null, {
      title: 'New team plan',
      team_id: TEAM_A,
      description: '  drills  ',
    })
    expect(teamPlan!.team_id).toBe(TEAM_A)
    expect(teamPlan!.student_id).toBeNull()
    expect(teamPlan!.description).toBe('drills') // trimmed, empty string would have been null

    const studentPlan = await createTrainingPlan(ORG, null, { title: 'New student plan', student_id: ALICE })
    expect(studentPlan!.student_id).toBe(ALICE)
    expect(studentPlan!.team_id).toBeNull()

    const both = await createTrainingPlan(ORG, null, {
      title: 'Both',
      team_id: TEAM_B,
      student_id: BOB,
    })
    expect(both!.team_id).toBe(TEAM_B)
    expect(both!.student_id).toBe(BOB)
  })

  test('setTrainingPlanStatus only accepts the three DDL-checked values', async () => {
    const club = (await listTrainingPlans(ORG)).find((r) => r.title === 'Club plan')!
    expect((await setTrainingPlanStatus(ORG, club.id, 'done'))!.status).toBe('done')
    expect((await setTrainingPlanStatus(ORG, club.id, 'archived'))!.status).toBe('archived')
    expect((await setTrainingPlanStatus(ORG, club.id, 'active'))!.status).toBe('active')
    // Anything else is refused in JS, before the statement — so a typo cannot
    // reach the CHECK constraint as a 500.
    expect(await setTrainingPlanStatus(ORG, club.id, 'paused')).toBeNull()
    expect(await setTrainingPlanStatus(ORG, club.id, '')).toBeNull()
    expect((await getTrainingPlan(ORG, club.id))!.status).toBe('active')
  })

  test('setTrainingPlanStatus is org-scoped and misses cleanly', async () => {
    const club = (await listTrainingPlans(ORG)).find((r) => r.title === 'Club plan')!
    expect(await setTrainingPlanStatus(OTHER, club.id, 'done')).toBeNull()
    expect(await setTrainingPlanStatus(ORG, '9c7e0001-0000-4000-8000-0000000000ee', 'done')).toBeNull()
    expect((await getTrainingPlan(ORG, club.id))!.status).toBe('active')
  })

  test('deleteTrainingPlan reports true only for a row it actually removed, org-scoped', async () => {
    const club = (await listTrainingPlans(ORG)).find((r) => r.title === 'Club plan')!
    expect(await deleteTrainingPlan(OTHER, club.id)).toBe(false)
    expect(await deleteTrainingPlan(ORG, club.id)).toBe(true)
    expect(await deleteTrainingPlan(ORG, club.id)).toBe(false)
    expect(titles(await listTrainingPlans(ORG))).not.toContain('Club plan')
  })
})