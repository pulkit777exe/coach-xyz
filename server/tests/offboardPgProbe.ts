// Member offboarding against ephemeral Postgres, in a fresh process so no
// other file's `mock.module` stubs can interfere. No mocks here at all: the
// real data layer runs against TEST_DATABASE_URL. Each scenario throws on
// mismatch; a zero exit plus the printed summary means all passed.

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { getLinkedPlayer } from '../src/lib/orgData'
import { findActiveMemberRowId, offboardMember } from '../src/lib/orgOffboard'
import { getMemberRole, inviteOrgMember } from '../src/lib/orgMembers'
import { visibleStudentIds } from '../src/lib/org/scope'
import { listMemberTeamIdsInOrg } from '../src/lib/teams'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
if (!TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL must be set')
  process.exit(1)
}
process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const ORG = 'auth0|offboard-org'
const ORG_B = 'auth0|offboard-other'
const COACH = 'auth0|offboard-coach'
const COACH2 = 'auth0|offboard-coach2'
const SUCCESSOR = 'auth0|offboard-successor'
const PLAYER = 'auth0|offboard-player'
const LINKED_PLAYER = 'auth0|offboard-linked'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'
const TEAM_C = '00000000-0000-4000-8000-0000000000c1'
const STUDENT_A = '00000000-0000-4000-8000-0000000000d1'

const check = (cond: boolean, message: string): void => {
  if (!cond) throw new Error(message)
}

const db = new SQL(TEST_DATABASE_URL)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

// Idempotent pre-clean.
await db`delete from team_memberships where member_auth0_id in (${COACH}, ${COACH2}, ${SUCCESSOR}, ${PLAYER});`
await db`delete from team_memberships where student_id = ${STUDENT_A}::uuid;`
await db`delete from students where id = ${STUDENT_A}::uuid;`
await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${TEAM_C}::uuid);`
await db`delete from org_members where org_auth0_id in (${ORG}, ${ORG_B});`
// A users row lets re-invites link the membership to the account (the
// production path); without it inviteOrgMember stores a NULL sub and the
// scenario below would offboard a phantom row.
await db`delete from users where auth0_id = ${COACH};`
await db`insert into users (auth0_id, email) values (${COACH}, 'coach@example.com');`

await db`insert into teams (id, org_auth0_id, name) values (${TEAM_A}::uuid, ${ORG}, 'A'), (${TEAM_B}::uuid, ${ORG}, 'B');`
await db`insert into teams (id, org_auth0_id, name) values (${TEAM_C}::uuid, ${ORG_B}, 'C');`
await db`insert into students (id, auth0_id, full_name, team_id, account_auth0_id) values (${STUDENT_A}::uuid, ${ORG}, 'Off Board', ${TEAM_A}::uuid, ${LINKED_PLAYER});`
await db`insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status) values (${ORG}, ${COACH}, 'coach@example.com', 'coach', 'active'), (${ORG}, ${COACH2}, 'coach2@example.com', 'coach', 'active'), (${ORG}, ${SUCCESSOR}, 'succ@example.com', 'head_coach', 'active'), (${ORG}, ${PLAYER}, 'player@example.com', 'player', 'active');`
await db`insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status) values (${ORG_B}, ${COACH}, 'coach@example.com', 'coach', 'active');`
await db`insert into team_memberships (team_id, member_auth0_id, role) values (${TEAM_A}::uuid, ${COACH}, 'coach'), (${TEAM_B}::uuid, ${COACH}, 'coach'), (${TEAM_A}::uuid, ${COACH2}, 'coach');`
await db`insert into team_memberships (team_id, member_auth0_id, role) values (${TEAM_C}::uuid, ${COACH}, 'coach');`

const done: string[] = []
const memberRow = async (org: string, sub: string): Promise<string> => {
  const id = await findActiveMemberRowId(org, sub)
  check(id !== null, `no active row for ${sub} in ${org}`)
  return id as string
}

// 1. Offboard with a successor: teams transfer, scope follows.
{
  const prior = await listMemberTeamIdsInOrg(ORG, COACH)
  const rowId = await memberRow(ORG, COACH)
  const succId = await memberRow(ORG, SUCCESSOR)
  const result = await offboardMember(ORG, rowId, succId, {})
  check(result !== null && result.ok, `offboard failed: ${JSON.stringify(result)}`)
  if (result !== null && result.ok) {
    check(
      [...result.teamIds].sort().join(',') === [...prior].sort().join(','),
      'transferred set differs from prior set',
    )
    check(result.successorSub === SUCCESSOR, 'wrong successor sub')
  }
  const succTeams = await listMemberTeamIdsInOrg(ORG, SUCCESSOR)
  check(
    [...succTeams].sort().join(',') === [...prior].sort().join(','),
    'successor team rows differ',
  )
  const visible = await visibleStudentIds(ORG, { all: false, teamIds: succTeams })
  check(visible !== null && visible.includes(STUDENT_A), 'successor cannot see the student')
  check((await getMemberRole(ORG, COACH)) === null, 'leaver still has a role')
  done.push('successor')
}

// 2. Another org's team rows for the same account survive.
{
  check((await getMemberRole(ORG_B, COACH)) === 'coach', 'other-org role gone')
  check(
    JSON.stringify(await listMemberTeamIdsInOrg(ORG_B, COACH)) ===
      JSON.stringify([TEAM_C]),
    'other-org teams changed',
  )
  done.push('cross-org')
}

// 3. Re-invite yields an empty scope.
{
  const member = await inviteOrgMember(ORG, ORG, {
    email: 'coach@example.com',
    role: 'coach',
  })
  check(member !== null, 're-invite failed')
  check(
    (await listMemberTeamIdsInOrg(ORG, COACH)).length === 0,
    're-invited coach has teams',
  )
  done.push('reinvite')
}

// 4. Custodian path: no successor, owner gets no team rows.
{
  const rowId = await memberRow(ORG, COACH2)
  const result = await offboardMember(ORG, rowId, null, {})
  check(result !== null && result.ok, `custodian offboard failed: ${JSON.stringify(result)}`)
  if (result !== null && result.ok) {
    check(result.successorSub === null, 'custodian path names a successor')
    check(result.teamIds.includes(TEAM_A), 'custodian team set wrong')
  }
  const ownerTeams = await listMemberTeamIdsInOrg(ORG, ORG)
  check(ownerTeams.length === 0, 'owner gained team rows')
  done.push('custodian')
}

// 5. The owner cannot be removed.
{
  const ownerRows = await db<{ id: string }[]>`insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status) values (${ORG}, ${ORG}, 'owner@example.com', 'owner', 'active') on conflict (org_auth0_id, member_auth0_id) do nothing returning id;`
  const existing = ownerRows?.[0]?.id ?? (
    await db<{ id: string }[]>`select id from org_members where org_auth0_id = ${ORG} and member_auth0_id = ${ORG} limit 1;`
  )?.[0]?.id
  check(!!existing, 'no owner row')
  const result = await offboardMember(ORG, existing as string, null, {})
  check(
    result !== null && !result.ok && result.status === 400,
    `owner refusal wrong: ${JSON.stringify(result)}`,
  )
  done.push('owner-refused')
}

// 6. A player cannot self-leave.
{
  const rowId = await memberRow(ORG, PLAYER)
  const result = await offboardMember(ORG, rowId, null, { self: true })
  check(
    result !== null && !result.ok && result.status === 400,
    `player refusal wrong: ${JSON.stringify(result)}`,
  )
  check((await getMemberRole(ORG, PLAYER)) === 'player', 'player row disturbed')
  done.push('player-refused')
}

// 7. A mid-transaction failure rolls everything back.
{
  const re = await inviteOrgMember(ORG, ORG, { email: 'coach@example.com', role: 'coach' })
  check(re !== null, 're-invite for rollback failed')
  await db`insert into team_memberships (team_id, member_auth0_id, role) values (${TEAM_B}::uuid, ${COACH}, 'coach') on conflict (team_id, member_auth0_id, student_id) do nothing;`
  await db.unsafe(`create or replace function fail_leave() returns trigger as $$
    begin raise exception 'injected'; end; $$ language plpgsql;`)
  await db.unsafe(
    `create trigger fail_leave_trigger before delete on org_members for each row execute function fail_leave();`,
  )
  try {
    let threw = false
    try {
      await offboardMember(ORG, re!.id, null, {})
    } catch {
      threw = true
    }
    check(threw, 'rollback: expected a throw')
    check((await getMemberRole(ORG, COACH)) === 'coach', 'rollback: role gone')
    check(
      (await listMemberTeamIdsInOrg(ORG, COACH)).includes(TEAM_B),
      'rollback: teams gone',
    )
  } finally {
    await db.unsafe(`drop trigger fail_leave_trigger on org_members;`)
    await db.unsafe(`drop function fail_leave();`)
  }
  done.push('rollback')
}

// 8. A linked player's reads are unchanged across the offboard.
{
  const linked = await getLinkedPlayer(LINKED_PLAYER)
  check(linked?.student.id === STUDENT_A, 'player link disturbed')
  check(linked?.coachAuth0Id === ORG, 'player coach disturbed')
  done.push('player-link')
}

await db.close()
console.log(JSON.stringify({ done }))
