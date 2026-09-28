// Student-team link cases against ephemeral Postgres, in a fresh process so
// no other file's `mock.module` stubs can interfere. No mocks here at all:
// the real routes + real data layer run against TEST_DATABASE_URL, with the
// guard inert (SERVICE_TOKEN scrubbed) and the owner fast-path as caller.
// Failing checks throw with a message naming the scenario.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { getStudent } from '../src/lib/org/students'
import { getTeamMembership, listTeamMembers } from '../src/lib/teams'
import teamsRoutes from '../src/routes/teams'
import studentsRoutes from '../src/routes/org/students'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const ORG = 'auth0|link-org'
const OTHER = 'auth0|link-other'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'
const FOREIGN_TEAM = '00000000-0000-4000-8000-0000000000c1'
const STUDENT = '00000000-0000-4000-8000-0000000000d1'

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const call = async (
  app: { handle: (req: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': ORG },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) ?? {} }
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()
// Idempotent pre-clean: FK-less residue from a red run must not fail green.
await db`delete from team_memberships where student_id = ${STUDENT}::uuid;`
await db`delete from students where id = ${STUDENT}::uuid;`
await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${FOREIGN_TEAM}::uuid);`
await db`insert into teams (id, org_auth0_id, name) values (${TEAM_A}::uuid, ${ORG}, 'A'), (${TEAM_B}::uuid, ${ORG}, 'B');`
await db`insert into teams (id, org_auth0_id, name) values (${FOREIGN_TEAM}::uuid, ${OTHER}, 'F');`
await db`insert into students (id, auth0_id, full_name) values (${STUDENT}::uuid, ${ORG}, 'Link Test');`

const done: string[] = []

// Each scenario starts from a clean link: the team delete in setup cascades
// memberships once, but scenarios share the tables afterwards.
const reset = async (): Promise<void> => {
  await db`delete from team_memberships where student_id = ${STUDENT}::uuid;`
  await db`update students set auth0_id = ${ORG}, team_id = null where id = ${STUDENT}::uuid;`
}

// 1. Adding a student to a team sets team_id and the roster row.
{
  await reset()
  const res = await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    student_id: STUDENT,
  })
  check(res.status === 201, `add: expected 201, got ${res.status}`)
  check((await getStudent(ORG, STUDENT))?.team_id === TEAM_A, 'add: team_id not set')
  const members = await listTeamMembers(TEAM_A)
  check(
    members.map((m) => m.student_id).includes(STUDENT),
    'add: roster row missing',
  )
  done.push('add')
}

// 2. A student from another org cannot be filed onto the team.
  await reset()
{
  await db`update students set auth0_id = ${OTHER} where id = ${STUDENT}::uuid;`
  const res = await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    student_id: STUDENT,
  })
  check(res.status === 404, `foreign: expected 404, got ${res.status}`)
  check((await listTeamMembers(TEAM_A)).length === 0, 'foreign: roster row written')
  await db`update students set auth0_id = ${ORG} where id = ${STUDENT}::uuid;`
  done.push('foreign')
}

// 3. Removing a student membership clears team_id, not just the row.
  await reset()
{
  const added = await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    student_id: STUDENT,
  })
  const membershipId = (added.body.member as { id: string }).id
  const res = await call(
    teamsRoutes,
    'DELETE',
    `/api/org/${ORG}/teams/${TEAM_A}/members/${membershipId}`,
  )
  check(res.status === 200, `remove: expected 200, got ${res.status}`)
  check((await getStudent(ORG, STUDENT))?.team_id === null, 'remove: team_id not cleared')
  check((await getTeamMembership(TEAM_A, membershipId)) === null, 'remove: row survives')
  done.push('remove')
}

// 4. PUT team_id moves the player and mirrors both sides.
  await reset()
{
  await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    student_id: STUDENT,
  })
  const res = await call(studentsRoutes, 'PUT', `/api/org/${ORG}/students/${STUDENT}`, {
    team_id: TEAM_B,
  })
  check(res.status === 200, `move: expected 200, got ${res.status}`)
  check((res.body.student as { team_id: string }).team_id === TEAM_B, 'move: response stale')
  check((await getStudent(ORG, STUDENT))?.team_id === TEAM_B, 'move: team_id not moved')
  const onA = (await listTeamMembers(TEAM_A)).map((m) => m.student_id)
  check(!onA.includes(STUDENT), 'move: old roster row survives')
  const onB = (await listTeamMembers(TEAM_B)).map((m) => m.student_id)
  check(onB.includes(STUDENT), 'move: new roster row missing')
  done.push('move')
}

// 5. PUT team_id null unassigns and drops the roster row.
  await reset()
{
  const res = await call(studentsRoutes, 'PUT', `/api/org/${ORG}/students/${STUDENT}`, {
    team_id: null,
  })
  check(res.status === 200, `unassign: expected 200, got ${res.status}`)
  check((await getStudent(ORG, STUDENT))?.team_id === null, 'unassign: team_id survives')
  const onB = (await listTeamMembers(TEAM_B)).map((m) => m.student_id)
  check(!onB.includes(STUDENT), 'unassign: roster row survives')
  done.push('unassign')
}

// 6. Deleting the team unassigns the player and drops memberships.
  await reset()
{
  await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    student_id: STUDENT,
  })
  const res = await call(teamsRoutes, 'DELETE', `/api/org/${ORG}/teams/${TEAM_A}`)
  check(res.status === 200, `delete-team: expected 200, got ${res.status}`)
  check((await getStudent(ORG, STUDENT))?.team_id === null, 'delete-team: team_id survives')
  check((await listTeamMembers(TEAM_A)).length === 0, 'delete-team: memberships survive')
  done.push('delete-team')
}

await db.close()
console.log(JSON.stringify({ done }))
