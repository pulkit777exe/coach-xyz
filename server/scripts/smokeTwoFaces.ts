// End-to-end two-faces flow against the live history DB, then cleans up its
// own rows. Uses a random suffix so it never touches real data.
//
//   cd server && bun run scripts/smokeTwoFaces.ts
import {
  ensureInitialized,
  withHistoryStore,
} from '../src/lib/historyStore'
import { upsertUser, getUserByAuth0Id } from '../src/lib/users'
import { createStudent, deleteStudent, getLinkedPlayer } from '../src/lib/orgData'

const tag = `smoke-${Math.random().toString(36).slice(2, 8)}`
const coachId = `test|${tag}-coach`
const playerId = `test|${tag}-player`
const email = `${tag}+player@example.com`
let studentId: string | undefined

async function fail(msg: string): Promise<never> {
  console.error(JSON.stringify({ type: 'smoke_failed', step: msg }))
  process.exit(1)
}

async function cleanup() {
  if (studentId) await deleteStudent(coachId, studentId).catch(() => {})
  await withHistoryStore(
    (db) => db`delete from users where auth0_id in (${coachId}, ${playerId});`,
  ).catch(() => {})
  console.log('smoke_cleanup_done')
}

async function main() {
  await ensureInitialized()

  const coach = await upsertUser({
    sub: coachId,
    name: 'Smoke Coach',
    email_verified: true,
  })
  if (!coach) return fail('coach user not created')
  if (coach.role !== 'coach') return fail(`coach role=${coach.role} expected coach`)

  const student = await createStudent(coachId, {
    full_name: 'Smoke Player',
    email,
    status: 'active',
    joined_on: '2026-01-15',
  })
  if (!student?.id) return fail('student not created')
  studentId = student.id

  const player = await upsertUser({
    sub: playerId,
    email,
    name: 'Smoke Player',
    email_verified: true,
  })
  if (!player) return fail('player user not created')
  if (player.role !== 'player') return fail(`player role=${player.role} expected player`)

  const linked = await getLinkedPlayer(playerId)
  if (linked?.student?.id !== studentId)
    return fail(`getLinkedPlayer did not resolve to student (${linked?.student?.id})`)

  const reRead = await getUserByAuth0Id(playerId)
  if (reRead?.role !== 'player') return fail('player persisted role is not player')

  const coachReRead = await getUserByAuth0Id(coachId)
  if (coachReRead?.role !== 'coach') return fail('coach role changed unexpectedly')

  console.log(
    JSON.stringify({
      type: 'smoke_ok',
      tag,
      coachRole: coach.role,
      playerRole: player.role,
      studentId,
      linkedStudentId: linked.student.id,
      reReadPlayerRole: reRead?.role,
    }),
  )
}

main()
  .catch(async (e) => {
    console.error(JSON.stringify({ type: 'smoke_error', error: String(e) }))
    await cleanup()
    process.exit(1)
  })
  .then(async () => {
    await cleanup()
    process.exit(0)
  })
