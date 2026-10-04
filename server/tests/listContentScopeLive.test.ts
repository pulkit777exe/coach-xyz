import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { listStudents } from '../src/lib/org/students'
import { listAttendance } from '../src/lib/org/attendance'
import { listObjectives } from '../src/lib/org/objectives'
import { listReports } from '../src/lib/org/reports'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── A 200 is not a scope: pin what the LIST actually contains ────────────────
//
// The authorization matrix asserts a status per route × role, so every scoped list
// route is recorded as `200` for a team coach. That is the whole extent of its
// knowledge: it cannot see whether the response BODY included another team's rows.
// A route that narrowed its status but not its query would be a pass.
//
// This is not hypothetical. It is the shape of both bugs this repo already shipped
// on this surface. `GET /students/sports` was `select distinct sport from students
// where auth0_id = $1` with no scope at all, and `/api/me/schedule` passed no
// `teamIds` while its org twin always had. Both answered 200 to a scoped caller,
// and the matrix could not tell.
//
// So this file asserts the CONTENT, against real SQL, for the four list functions
// that take a scope. A route-level test would only prove the route passes the
// option; the narrowing itself happens in SQL, and SQL is where it can silently
// stop narrowing.
//
// Two rules about the assertions below, because each has a way to pass while
// being wrong:
//   - every scoped case is paired with an UNSCOPED case on the same fixture. "Two
//     rows came back" is equally consistent with a working filter and with a
//     fixture that only ever held two rows; the unscoped read returning three is
//     what makes the difference evidence.
//   - the empty-scope case is its own case. `teamIds: []` means "assigned to no
//     team" and OMITTING the key means "org-wide". They are one keystroke apart and
//     mean opposite things, and the `/api/me/schedule` bug was exactly a missing
//     key. A filter that treated them alike would pass every other case here.
//
// Live Postgres, and this file spawns nothing — a suite that mixes a live database
// with probe spawns makes every probe in it wait on the inherited pool (see
// orgTeamScopeLive.test.ts, which is the same split done the other way round).

const ORG = 'auth0|list-scope-org'
const TEAM_A = '00000000-0000-0000-4000-0000000000a1'
const TEAM_B = '00000000-0000-0000-4000-0000000000b1'
const S_A1 = '00000000-0000-0000-4000-0000000000d1'
const S_A2 = '00000000-0000-0000-4000-0000000000d2'
const S_B1 = '00000000-0000-0000-4000-0000000000d3'
const O_A_TEAM = '00000000-0000-0000-4000-0000000000e1'
const O_A_STUDENT = '00000000-0000-0000-4000-0000000000e2'
const O_B_STUDENT = '00000000-0000-0000-4000-0000000000e3'

const TODAY = new Date().toISOString().slice(0, 10)

// `training_objectives` is keyed by `org_auth0_id` and the rest by `auth0_id`.
// Read off the DDL rather than assumed: this file's first draft guessed
// `auth0_id` for all four tables and died with 42703 on an empty fixture.
// A fixed uuid is a GLOBAL primary key, so every table this fixture inserts one
// into is cleaned by ID and never by org: a row another org inserted under the same
// uuid is invisible to `where org_auth0_id = ...`, and the insert below then raises
// a unique violation with nothing in this file's stack trace pointing at the cause.
// That is the exact failure `dataRightsPgProbe.ts` caused, and
// tests/fixtureIdCollisions.test.ts enforces the rule — it failed this file on its
// first run, correctly.
//
// reports and attendance get GENERATED ids, so for those the org sweep is the only
// way to clear residue from an interrupted run. Both keys, for both reasons.
const seed = async (db: SQL) => {
  await db`delete from reports where auth0_id = ${ORG}`
  await db`delete from attendance where auth0_id = ${ORG}`
  await db`delete from training_objectives where id in
    (${O_A_TEAM}::uuid, ${O_A_STUDENT}::uuid, ${O_B_STUDENT}::uuid)`
  await db`delete from students where id in (${S_A1}::uuid, ${S_A2}::uuid, ${S_B1}::uuid)`
  await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid)`

  await db`insert into teams (id, org_auth0_id, name, sport) values
    (${TEAM_A}::uuid, ${ORG}, 'Scope A', 'soccer'),
    (${TEAM_B}::uuid, ${ORG}, 'Scope B', 'rugby')`

  await db`insert into students (id, auth0_id, full_name, sport, status, team_id) values
    (${S_A1}::uuid, ${ORG}, 'Scope A1', 'soccer', 'active', ${TEAM_A}::uuid),
    (${S_A2}::uuid, ${ORG}, 'Scope A2', 'soccer', 'active', ${TEAM_A}::uuid),
    (${S_B1}::uuid, ${ORG}, 'Scope B1', 'rugby', 'active', ${TEAM_B}::uuid)`

  await db`insert into attendance (auth0_id, student_id, session_date, status) values
    (${ORG}, ${S_A1}::uuid, ${TODAY}, 'present'),
    (${ORG}, ${S_B1}::uuid, ${TODAY}, 'present')`

  // Three objectives, because `listObjectives` narrows on `team_id IN (...) OR
  // student_id IN (...)` and those two arms are reachable by DIFFERENT rows.
  // `training_objectives.team_id` is taken straight from the request body (see
  // `POST /objectives`) and is never derived from the student's team, so an
  // objective attached to a player has `team_id = NULL` — it is reachable only
  // through the student arm, while a team-tagged objective is reachable only
  // through the team arm. Asserting with one fixture covering only the second
  // shape would let the first arm rot silently.
  await db`insert into training_objectives (id, org_auth0_id, student_id, team_id, title, status) values
    (${O_A_TEAM}::uuid, ${ORG}, null, ${TEAM_A}::uuid, 'Team-tagged A objective', 'active'),
    (${O_A_STUDENT}::uuid, ${ORG}, ${S_A1}::uuid, null, 'Player-tagged A objective', 'active'),
    (${O_B_STUDENT}::uuid, ${ORG}, ${S_B1}::uuid, null, 'Player-tagged B objective', 'active')`

  // `report_type` is enum-checked to progress|attendance|performance|monthly.
  await db`insert into reports (auth0_id, student_id, title, report_type) values
    (${ORG}, ${S_A1}::uuid, 'Scope A report', 'progress'),
    (${ORG}, ${S_B1}::uuid, 'Scope B report', 'progress')`
}

const cleanup = async (db: SQL) => {
  await db`delete from reports where auth0_id = ${ORG}`
  await db`delete from attendance where auth0_id = ${ORG}`
  await db`delete from training_objectives where id in
    (${O_A_TEAM}::uuid, ${O_A_STUDENT}::uuid, ${O_B_STUDENT}::uuid)`
  await db`delete from students where id in (${S_A1}::uuid, ${S_A2}::uuid, ${S_B1}::uuid)`
  await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid)`
}

// Two different ids come back from these four functions and conflating them is
// how a scoping test passes for the wrong reason: `listStudents` returns the
// STUDENT's own uuid, while attendance / objectives / reports are all keyed to a
// student from a row that has an id of its own.
const rowIds = (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id).sort()
const studentIdsOf = (rows: Array<{ student_id: string | null }>): Array<string | null> =>
  rows.map((r) => r.student_id).sort()

const A_ONLY = [S_A1].sort()
const A_AND_B = [S_A1, S_B1].sort()
describeLiveDb('a scoped list narrows its CONTENT, not just its status', () => {
  useLiveTestDb({ seed, cleanup })

  test('listStudents narrows by team, and omitting the key is what org-wide means', async () => {
    expect(rowIds(await listStudents(ORG, { teamIds: [TEAM_A] }))).toEqual(
      [S_A1, S_A2].sort(),
    )
    expect(rowIds(await listStudents(ORG, {}))).toEqual([S_A1, S_A2, S_B1].sort())
    expect(await listStudents(ORG, { teamIds: [] })).toEqual([])
  })

  test('listAttendance narrows by visible students, and empty is not unfiltered', async () => {
    expect(studentIdsOf(await listAttendance(ORG, { studentIds: [S_A1, S_A2] }))).toEqual(
      A_ONLY,
    )
    expect(await listAttendance(ORG, { studentIds: [] })).toEqual([])
    // `null` is the org-wide spelling for this one, not an absent key.
    expect(studentIdsOf(await listAttendance(ORG, { studentIds: null }))).toEqual(A_AND_B)
    expect(studentIdsOf(await listAttendance(ORG, {}))).toEqual(A_AND_B)
  })

  test('listObjectives narrows on BOTH arms, and each arm carries a different row', async () => {
    // The team arm alone: only the objective TAGGED with team A. It must not
    // reach the player-tagged one, which is why this is a separate case.
    expect(rowIds(await listObjectives(ORG, { scope: { teamIds: [TEAM_A], studentIds: [] } }))).toEqual(
      [O_A_TEAM],
    )

    // The student arm alone. This is the shape a real coach call takes, and it is
    // the one a "teamIds already scopes it" refactor would silently empty: every
    // player-attached objective has `team_id = NULL`, so dropping `studentIds`
    // hides all of them and still answers 200.
    expect(rowIds(await listObjectives(ORG, { scope: { teamIds: [], studentIds: [S_A1] } }))).toEqual(
      [O_A_STUDENT],
    )

    // Both arms together: the shape the route actually sends.
    expect(
      rowIds(await listObjectives(ORG, { scope: { teamIds: [TEAM_A], studentIds: [S_A1] } })),
    ).toEqual([O_A_TEAM, O_A_STUDENT])

    expect(await listObjectives(ORG, { scope: { teamIds: [], studentIds: [] } })).toEqual([])
    expect(rowIds(await listObjectives(ORG, {}))).toEqual(
      [O_A_STUDENT, O_A_TEAM, O_B_STUDENT].sort(),
    )
  })

  test('listReports narrows to the visible students, and empty is not unfiltered', async () => {
    expect(studentIdsOf(await listReports(ORG, { visibleStudentIds: [S_A1, S_A2] }))).toEqual(
      A_ONLY,
    )
    expect(await listReports(ORG, { visibleStudentIds: [] })).toEqual([])
    expect(studentIdsOf(await listReports(ORG, {}))).toEqual(A_AND_B)
  })
})
