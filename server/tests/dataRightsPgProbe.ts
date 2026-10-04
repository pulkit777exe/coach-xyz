// Privacy execute-delete end to end against ephemeral Postgres, in a fresh
// process with no mocks. Seeds a linked player with an analysis, a
// notification, consent, and an in_progress delete request, then drives the
// real route and proves every trace is gone and the request completed.

import { mock } from 'bun:test'
import { SQL } from 'bun'

// The route graph reaches lib/redis.ts (import-time connector) via
// notifications → serverEvents. The shared quota is exhausted, so stub it
// inert: nothing under test touches Redis.
//
// Dynamic imports below: static imports evaluate before `mock.module` runs,
// so the routes would bind the real connector and hang in a reconnect loop.
mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

const { ensureInitialized, setHistoryStoreConnectionForTests } =
  await import('../src/lib/historyStore')
const { default: dataRights } = await import('../src/routes/org/dataRights')

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const ORG = 'auth0|dr-org'
const PLAYER = 'auth0|dr-player'
const TEAM = '00000000-0000-4000-8000-0000000000a1'
const STUDENT = '00000000-0000-4000-8000-0000000000b1'
const JOB = 'job-dr-probe'

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

// Idempotent pre-clean.
await db`delete from team_memberships where student_id = ${STUDENT}::uuid;`
await db`delete from wellness_checkins where student_id = ${STUDENT}::uuid;`
await db`delete from training_objectives where student_id = ${STUDENT}::uuid;`
await db`delete from training_plans where student_id = ${STUDENT}::uuid;`
await db`delete from analysis_history where server_job_id = ${JOB};`
await db`delete from player_events where server_job_id = ${JOB};`
await db`delete from reports where title = 'dr-rep';`
await db`delete from students where id = ${STUDENT}::uuid;`
await db`delete from notifications where auth0_id = ${PLAYER};`
await db`delete from privacy_requests where auth0_id = ${PLAYER};`
await db`delete from teams where id = ${TEAM}::uuid;`

await db`insert into teams (id, org_auth0_id, name) values (${TEAM}::uuid, ${ORG}, 'T');`
await db`insert into students (id, auth0_id, full_name, team_id, account_auth0_id) values (${STUDENT}::uuid, ${ORG}, 'Dee Leete', ${TEAM}::uuid, ${PLAYER});`
await db`insert into analysis_history (server_job_id, engine_job_id, model, auth0_id, student_id) values (${JOB}, 'eng-1', 'm', ${ORG}, ${STUDENT}::uuid);`
await db`insert into notifications (auth0_id, type, title) values (${PLAYER}, 'membership', 'hi');`
await db`insert into player_consents (student_id) values (${STUDENT}::uuid);`
await db`insert into privacy_requests (auth0_id, request_type, status) values (${PLAYER}, 'delete', 'in_progress');`
const req = (
  await db<
    { id: string }[]
  >`select id from privacy_requests where auth0_id = ${PLAYER} order by created_at desc limit 1;`
)[0]

const res = await dataRights.handle(
  new Request(`http://localhost/api/org/${ORG}/privacy-requests/${req.id}/execute-delete`, {
    method: 'POST',
    headers: { 'x-verified-auth0-id': ORG },
  }),
)
check(res.status === 200, `execute: expected 200, got ${res.status}`)

check(
  (await db`select id from students where id = ${STUDENT}::uuid;`).length === 0,
  'execute: student survives',
)
check(
  (await db`select server_job_id from analysis_history where server_job_id = ${JOB};`).length === 0,
  'execute: analysis survives',
)
check(
  (await db`select id from notifications where auth0_id = ${PLAYER};`).length === 0,
  'execute: notifications survive',
)
check(
  (await db`select student_id from player_consents where student_id = ${STUDENT}::uuid;`).length ===
    0,
  'execute: consent survives',
)
const done = await db<{ status: string }[]>`
  select status from privacy_requests where id = ${req.id}::uuid;
`
check(done[0]?.status === 'completed', 'execute: request not completed')

// Teardown, not just the pre-clean above.
//
// The probe inserted TEAM ...a1 and STUDENT ...b1 and previously exited without
// removing them, so every run left two rows behind. That is invisible while those
// ids are unique to this file and becomes a `duplicate key value violates unique
// constraint "teams_pkey"` in an unrelated suite the moment anything else claims
// the same uuid — which is what happened to studentImportTeam.test.ts. The residue
// is also why the id collision below was hard to see: the offending row belonged
// to a probe, not to the test that failed.
//
// Students first (FK to teams), then the team.
await db`delete from students where id = ${STUDENT}::uuid;`
await db`delete from teams where id = ${TEAM}::uuid;`

await db.close()
console.log(JSON.stringify({ executed: true }))
