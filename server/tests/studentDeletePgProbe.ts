// deleteStudent against ephemeral Postgres, in a fresh process so no other
// file's `mock.module` stubs can interfere. No mocks here at all: the real
// data layer runs against TEST_DATABASE_URL. Each scenario throws on mismatch;
// a zero exit plus the printed summary means all three passed.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { deleteStudent } from '../src/lib/org/students'
import { getUserAnalyses } from '../src/lib/analyses'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const ORG = 'auth0|delete-org'
const OTHER_ORG = 'auth0|other-org'
const TEAM = '00000000-0000-4000-8000-0000000000d1'
const STUDENT = '00000000-0000-4000-8000-0000000000d2'
const OUTSIDER = '00000000-0000-4000-8000-0000000000d3'
const JOB = 'job-delete-probe'

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

const seed = async (studentId: string): Promise<void> => {
  // Idempotent: FK-less residue from a red run must not fail green.
  await db`delete from team_memberships where student_id = ${studentId}::uuid;`
  await db`delete from wellness_checkins where student_id = ${studentId}::uuid;`
  await db`delete from training_objectives where student_id = ${studentId}::uuid;`
  await db`delete from training_plans where student_id = ${studentId}::uuid;`
  await db`delete from analysis_history where server_job_id = ${JOB};`
  await db`delete from player_events where server_job_id = ${JOB};`
  await db`delete from reports where title = 'rep';`
  await db`delete from students where id = ${studentId}::uuid;`
  await db`insert into teams (id, org_auth0_id, name) values (${TEAM}::uuid, ${ORG}, 'T') on conflict (id) do nothing;`
  await db`insert into students (id, auth0_id, full_name, team_id) values (${studentId}::uuid, ${ORG}, 'Ephe Meral', ${TEAM}::uuid);`
  await db`insert into wellness_checkins (org_auth0_id, student_id) values (${ORG}, ${studentId}::uuid);`
  await db`insert into training_objectives (org_auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'obj');`
  await db`insert into training_plans (org_auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'plan');`
  await db`insert into team_memberships (team_id, student_id, role) values (${TEAM}::uuid, ${studentId}::uuid, 'player');`
  await db`insert into analysis_history (server_job_id, engine_job_id, model, auth0_id, student_id) values (${JOB}, 'eng-1', 'm', ${ORG}, ${studentId}::uuid);`
  await db`insert into player_events (org_auth0_id, server_job_id, student_id, category) values (${ORG}, ${JOB}, ${studentId}::uuid, 'shot');`
  await db`insert into attendance (auth0_id, student_id, session_date, status) values (${ORG}, ${studentId}::uuid, '2026-09-01', 'present');`
  await db`insert into performance_metrics (auth0_id, student_id, metric_key, metric_value) values (${ORG}, ${studentId}::uuid, 'k', 1);`
  await db`insert into player_consents (student_id) values (${studentId}::uuid);`
  await db`insert into reports (auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'rep');`
}

const sweep = async (): Promise<void> => {
  await db`delete from analysis_history where server_job_id = ${JOB};`
  await db`delete from player_events where server_job_id = ${JOB};`
  await db`delete from reports where title = 'rep';`
}

const done: string[] = []

// 1. Private rows go, club analyses stay unlinked and listed.
{
  await seed(STUDENT)
  check((await deleteStudent(ORG, STUDENT)) === true, 'delete: expected true')
  check(
    (await db`select id from students where id = ${STUDENT}::uuid;`).length === 0,
    'delete: student survives',
  )
  check(
    (await db`select id from wellness_checkins where student_id = ${STUDENT}::uuid;`).length ===
      0,
    'delete: wellness survives',
  )
  check(
    (await db`select id from training_objectives where student_id = ${STUDENT}::uuid;`).length ===
      0,
    'delete: objectives survive',
  )
  check(
    (await db`select id from training_plans where student_id = ${STUDENT}::uuid;`).length === 0,
    'delete: plans survive',
  )
  check(
    (await db`select id from team_memberships where student_id = ${STUDENT}::uuid;`).length ===
      0,
    'delete: memberships survive',
  )
  check(
    (await db`select id from attendance where student_id = ${STUDENT}::uuid;`).length === 0,
    'delete: attendance cascade missing',
  )
  check(
    (await db`select id from performance_metrics where student_id = ${STUDENT}::uuid;`).length ===
      0,
    'delete: metrics cascade missing',
  )
  check(
    (await db`select student_id from player_consents where student_id = ${STUDENT}::uuid;`)
      .length === 0,
    'delete: consent cascade missing',
  )
  const reports = await db`select student_id from reports where title = 'rep';`
  check(reports.length === 1 && reports[0].student_id === null, 'delete: report not set null')
  const analyses =
    await db`select server_job_id, student_id from analysis_history where server_job_id = ${JOB};`
  check(analyses.length === 1 && analyses[0].student_id === null, 'delete: analysis not unlinked')
  const events = await db`select student_id from player_events where server_job_id = ${JOB};`
  check(events.length === 1 && events[0].student_id === null, 'delete: events not unlinked')
  const orgWide = await getUserAnalyses(ORG, 50, 0)
  check(
    orgWide.map((a) => a.server_job_id).includes(JOB),
    'delete: unlinked analysis missing from org history',
  )
  const unlinkedOnly = await getUserAnalyses(ORG, 50, 0, { studentIds: [] })
  check(
    unlinkedOnly.map((a) => a.server_job_id).includes(JOB),
    'delete: unlinked analysis missing from unlinked view',
  )
  await sweep()
  done.push('delete')
}

// 2. Another org's id deletes nothing.
{
  await seed(OUTSIDER)
  check((await deleteStudent(OTHER_ORG, OUTSIDER)) === false, 'foreign: expected false')
  check(
    (await db`select id from students where id = ${OUTSIDER}::uuid;`).length === 1,
    'foreign: student gone',
  )
  check((await deleteStudent(ORG, OUTSIDER)) === true, 'foreign cleanup: expected true')
  await sweep()
  done.push('foreign')
}

// 3. A mid-transaction failure rolls everything back.
{
  await seed(STUDENT)
  await db.unsafe(`create or replace function fail_plans() returns trigger as $$
    begin raise exception 'injected'; end; $$ language plpgsql;`)
  await db.unsafe(
    `create trigger fail_plans_trigger before delete on training_plans for each row execute function fail_plans();`,
  )
  try {
    let threw = false
    try {
      await deleteStudent(ORG, STUDENT)
    } catch {
      threw = true
    }
    check(threw, 'rollback: expected a throw')
    check(
      (await db`select id from students where id = ${STUDENT}::uuid;`).length === 1,
      'rollback: student gone',
    )
    check(
      (await db`select id from wellness_checkins where student_id = ${STUDENT}::uuid;`).length ===
        1,
      'rollback: wellness gone',
    )
  } finally {
    await db.unsafe(`drop trigger fail_plans_trigger on training_plans;`)
    await db.unsafe(`drop function fail_plans();`)
  }
  check((await deleteStudent(ORG, STUDENT)) === true, 'rollback cleanup: expected true')
  await sweep()
  done.push('rollback')
}

await db.close()
console.log(JSON.stringify({ done }))
