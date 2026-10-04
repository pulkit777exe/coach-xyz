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
// A coach who IS a member of ORG (so the same-org case is legitimate), one who is
// a member of a DIFFERENT org, and one with no membership row at all. All three
// are valid auth0 subs as far as the request is concerned — only the org
// membership row distinguishes them.
const MEMBER_COACH = 'auth0|link-coach'
const FOREIGN_MEMBER = 'auth0|link-foreign-coach'
const STRANGER = 'auth0|link-stranger'

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const call = async (
  app: { handle: (req: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  identity: string = ORG,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': identity },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return {
    status: res.status,
    body: ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>,
  }
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()
// Idempotent pre-clean: FK-less residue from a red run must not fail green.
await db`delete from team_memberships where member_auth0_id in (${MEMBER_COACH}, ${FOREIGN_MEMBER}, ${STRANGER});`
await db`delete from org_members where member_auth0_id in (${MEMBER_COACH}, ${FOREIGN_MEMBER}, ${STRANGER});`
await db`delete from team_memberships where student_id = ${STUDENT}::uuid;`
await db`delete from students where id = ${STUDENT}::uuid;`
await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${FOREIGN_TEAM}::uuid);`
await db`insert into teams (id, org_auth0_id, name) values (${TEAM_A}::uuid, ${ORG}, 'A'), (${TEAM_B}::uuid, ${ORG}, 'B');`
await db`insert into teams (id, org_auth0_id, name) values (${FOREIGN_TEAM}::uuid, ${OTHER}, 'F');`
await db`insert into students (id, auth0_id, full_name) values (${STUDENT}::uuid, ${ORG}, 'Link Test');`
// ACTIVE is load-bearing: `getMemberRole` admits active rows only, so an
// invited-but-unlinked account is refused exactly like a stranger. That is the
// predicate the identity boundary itself uses, so it cannot drift from it.
await db`
  insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status)
  values
    (${ORG}, ${MEMBER_COACH}, 'link-coach@example.com', 'coach', 'active'),
    (${OTHER}, ${FOREIGN_MEMBER}, 'link-foreign@example.com', 'coach', 'active');
`

const done: string[] = []

const coachRows = (teamId: string) =>
  db<{ member_auth0_id: string }[]>`
    select member_auth0_id from team_memberships
    where team_id = ${teamId}::uuid and member_auth0_id is not null;
  `

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
  check(members.map((m) => m.student_id).includes(STUDENT), 'add: roster row missing')
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

// ── Coach-side membership rows ───────────────────────────────────────────────
// Scenario 6 deleted TEAM_A, so re-plant both teams before these run — otherwise
// the add is refused by the org check for the wrong reason (a 404 on the team),
// which would make the non-member case below pass vacuously.
await db`delete from team_memberships where member_auth0_id in (${MEMBER_COACH}, ${FOREIGN_MEMBER}, ${STRANGER});`
await db`
  insert into teams (id, org_auth0_id, name)
  values (${TEAM_A}::uuid, ${ORG}, 'A'), (${TEAM_B}::uuid, ${ORG}, 'B')
  on conflict (id) do nothing;
`
await db`insert into teams (id, org_auth0_id, name) values (${FOREIGN_TEAM}::uuid, ${OTHER}, 'F') on conflict (id) do nothing;`

// `team_memberships.member_auth0_id` is a bare account id: no org column, no
// foreign key to `org_members`. So `addTeamMember` could file ANY sub — another
// org's member, or a stranger with no membership at all — onto this org's team.
// Nothing is GRANTED by the row (the role still resolves through `org_members`,
// and `listMemberTeamIdsInOrg` joins `teams`), which makes this roster pollution
// rather than privilege escalation — but it is a durable cross-tenant write, and
// the row outlives any later cleanup of the membership that justified it.

// 7. The negative direction: a sub that is not a member of this org is refused
// and NO row is written. Asserted against the table, not the status alone,
// because a check made after the insert would still answer 404.
{
  for (const sub of [FOREIGN_MEMBER, STRANGER]) {
    const res = await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
      member_auth0_id: sub,
      role: 'coach',
    })
    // 404, not 403: the id in the body names nothing in this org, which is
    // indistinguishable from naming nothing at all — the same answer the sibling
    // student branch already gives for a foreign student_id.
    check(res.status === 404, `foreign-member(${sub}): expected 404, got ${res.status}`)
  }
  check(
    (await coachRows(TEAM_A)).length === 0,
    'foreign-member: a roster row was written for a non-member',
  )
  done.push('foreign-member')
}

// 8. The legitimate case still works: a real member of this org is added.
{
  const res = await call(teamsRoutes, 'POST', `/api/org/${ORG}/teams/${TEAM_A}/members`, {
    member_auth0_id: MEMBER_COACH,
    role: 'coach',
  })
  check(res.status === 201, `own-member: expected 201, got ${res.status}`)
  const subs = (await coachRows(TEAM_A)).map((r) => r.member_auth0_id)
  check(subs.includes(MEMBER_COACH), 'own-member: roster row missing')
  // The negative direction needs its own positive, or case 7 is satisfied by a
  // check that refuses everyone.
  check(!subs.includes(FOREIGN_MEMBER), 'own-member: a foreign sub leaked in')
  done.push('own-member')
}

// 9. DELETE is org-scoped too. `guard` asks `canAccessTeam`, which owners bypass
// unconditionally, and `removeTeamMember` is keyed on `team_id` alone — a
// membership uuid is globally unique, so naming another org's team uuid reached
// its roster row. The caller is the org owner precisely because that is the role
// the scope check does not constrain.
{
  // Set up as OTHER's own owner, so the victim row exists legitimately.
  const foreignAdd = await call(
    teamsRoutes,
    'POST',
    `/api/org/${OTHER}/teams/${FOREIGN_TEAM}/members`,
    { member_auth0_id: FOREIGN_MEMBER, role: 'coach' },
    OTHER,
  )
  check(foreignAdd.status === 201, `foreign-delete setup: expected 201, got ${foreignAdd.status}`)
  const membershipId = (foreignAdd.body.member as { id: string }).id

  // ORG's owner (the verified id on every `call`) targeting OTHER's team.
  const res = await call(
    teamsRoutes,
    'DELETE',
    `/api/org/${ORG}/teams/${FOREIGN_TEAM}/members/${membershipId}`,
  )
  check(res.status === 404, `foreign-delete: expected 404, got ${res.status}`)
  // The victim's row must survive the refused delete.
  const victimSubs = (await coachRows(FOREIGN_TEAM)).map((r) => r.member_auth0_id)
  check(victimSubs.includes(FOREIGN_MEMBER), 'foreign-delete: the victim roster row was deleted')
  done.push('foreign-delete')
}

// Teardown, not just the pre-clean above.
//
// This probe's ids (…a1/…b1/…c1/…d1) are shared with several other fixtures, and it
// previously exited without removing its own rows, so every run left three teams
// and a student behind. Those leftovers then broke studentImportTeam.test.ts with a
// `teams_pkey` duplicate — a failure three files away from its cause, reported
// against a file that had done nothing wrong.
//
// Order matters: memberships, then students (FK to teams), then teams, then the
// org_members rows.
await db`delete from team_memberships where member_auth0_id in (${MEMBER_COACH}, ${FOREIGN_MEMBER});`.catch(
  () => {},
)
await db`delete from team_memberships where student_id = ${STUDENT}::uuid;`
await db`delete from students where id = ${STUDENT}::uuid;`
await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${FOREIGN_TEAM}::uuid);`
await db`delete from org_members where member_auth0_id in (${MEMBER_COACH}, ${FOREIGN_MEMBER});`
await db.close()
console.log(JSON.stringify({ done }))
