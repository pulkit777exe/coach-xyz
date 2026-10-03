import { beforeEach, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  attendanceSummary,
  deleteAttendance,
  listAttendance,
  setAttendanceBatch,
  upsertAttendance,
} from '../src/lib/org/attendance'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Attendance data layer: the batch write, the scope filter, the summary ────
//
// The uncovered half of this module is `setAttendanceBatch` (the multi-row
// upsert), `upsertAttendance`, `deleteAttendance` and the `scopeFilter` branches
// of the list/summary pair. All of them are SQL the class AGENTS.md says no
// fixture can produce:
//
//   • `setAttendanceBatch` assembles a placeholder list in JS (`($1, $2, $3::date,
//     $4, $5)` per entry) and binds positionally through `db.unsafe`, which does
//     NOT bind its own `${}`. An off-by-one in `base = i * 5` writes one entry's
//     status into another's row — and `attendance`'s UNIQUE is
//     (auth0_id, student_id, session_date), so the batch would still succeed.
//   • The intra-batch duplicate collapse is not cosmetic: one multi-row
//     `ON CONFLICT DO UPDATE` cannot touch the same row twice (Postgres raises
//     "ON CONFLICT DO UPDATE command cannot affect row a second time"), and the
//     sequential-upsert semantics it replaced left the LAST write standing, so
//     "last wins" is the contract.
//   • An EMPTY scoped list binds NULL, not `[]` (a raw array reaches Postgres as
//     '' and is not a valid uuid[] literal). `not scoped or student_id =
//     any(NULL::uuid[])` matches nothing — the honest answer for a coach who
//     manages no team — and `null` (org-wide) must stay distinguishable from it.
//
// Live Postgres, and this file spawns nothing — see the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file.

const ORG = 'auth0|attlive-org'
const OTHER = 'auth0|attlive-other'
const ALICE = '9b6d0001-0000-4000-8000-0000000000a1'
const BOB = '9b6d0001-0000-4000-8000-0000000000a2'
const CAROL = '9b6d0001-0000-4000-8000-0000000000a3'
const OTHER_STUDENT = '9b6d0001-0000-4000-8000-0000000000f1'

let db: SQL | null = null

const resetRows = async (conn: SQL) => {
  await conn`delete from attendance where auth0_id = ${ORG} or auth0_id = ${OTHER}`
  await conn`delete from students where id in (${ALICE}::uuid, ${BOB}::uuid, ${CAROL}::uuid, ${OTHER_STUDENT}::uuid)`
  await conn`
    insert into students (id, auth0_id, full_name, sport, status)
    values
      (${ALICE}::uuid, ${ORG}, 'Alice', 'basketball', 'active'),
      (${BOB}::uuid, ${ORG}, 'Bob', 'basketball', 'active'),
      (${CAROL}::uuid, ${ORG}, 'Carol', 'soccer', 'active'),
      (${OTHER_STUDENT}::uuid, ${OTHER}, 'Foreign', 'soccer', 'active');
  `
  await conn`
    insert into attendance (auth0_id, student_id, session_date, status, note)
    values
      (${ORG}, ${ALICE}::uuid, '2026-03-01', 'present', null),
      (${ORG}, ${ALICE}::uuid, '2026-03-02', 'late', 'trained late'),
      (${ORG}, ${BOB}::uuid,   '2026-03-01', 'absent', 'ill'),
      (${ORG}, ${BOB}::uuid,   '2026-03-02', 'present', null),
      (${ORG}, ${CAROL}::uuid, '2026-03-01', 'excused', 'tournament'),
      (${ORG}, ${CAROL}::uuid, '2026-04-01', 'present', null),
      (${OTHER}, ${OTHER_STUDENT}::uuid, '2026-03-01', 'present', null);
  `
}

const titles = (rows: { full_name: string | null }[]): (string | null)[] =>
  rows.map((r) => r.full_name).sort()

describeLiveDb('attendance: the batch upsert, the student scope, and the summary', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await conn`delete from attendance where auth0_id = ${ORG} or auth0_id = ${OTHER}`
      await conn`delete from students where id in (${ALICE}::uuid, ${BOB}::uuid, ${CAROL}::uuid, ${OTHER_STUDENT}::uuid)`
    },
  })

  beforeEach(async () => {
    await resetRows(db!)
  })

  test('an org-wide list joins the student row and orders date desc then name', async () => {
    const rows = await listAttendance(ORG)
    expect(rows.length).toBe(6)
    // The join is what makes `full_name` available at all — without it every row
    // would read as an anonymous uuid on the sheet.
    expect(titles(rows)).toEqual([
      'Alice',
      'Alice',
      'Bob',
      'Bob',
      'Carol',
      'Carol',
    ])
    expect(rows.every((r) => r.auth0_id === ORG)).toBe(true)
  })

  test("the list is org-scoped: another org's attendance is never visible", async () => {
    const rows = await listAttendance(ORG)
    expect(rows.some((r) => r.full_name === 'Foreign')).toBe(false)
    expect((await listAttendance(OTHER)).length).toBe(1)
  })

  test('a scoped list narrows to exactly those students', async () => {
    const rows = await listAttendance(ORG, { studentIds: [ALICE] })
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.student_id === ALICE)).toBe(true)
  })

  test('an EMPTY scoped list returns nothing — not org-wide', async () => {
    // The coach who manages no team sees nobody. Collapsing `[]` into `null`
    // (org-wide) would hand that coach the whole org's attendance sheet.
    expect(await listAttendance(ORG, { studentIds: [] })).toEqual([])
  })

  test('null studentIds is org-wide, and is NOT the same as []', async () => {
    expect((await listAttendance(ORG, { studentIds: null })).length).toBe(6)
    expect((await listAttendance(ORG, { studentIds: [] })).length).toBe(0)
  })

  test('from/to bound the session date inclusively', async () => {
    // >= 2026-03-02 → Alice+Bob on the 2nd and Carol on 04-01.
    expect((await listAttendance(ORG, { from: '2026-03-02' })).length).toBe(3)
    expect((await listAttendance(ORG, { to: '2026-03-01' })).length).toBe(3)
    expect((await listAttendance(ORG, { from: '2026-03-01', to: '2026-03-01' })).length).toBe(3)
  })

  test('studentId and studentIds compose: both must match', async () => {
    expect((await listAttendance(ORG, { studentId: ALICE })).length).toBe(2)
    // A filter naming a student outside the scope list must answer nothing, not
    // fall back to org-wide.
    expect(await listAttendance(ORG, { studentId: BOB, studentIds: [ALICE] })).toEqual([])
  })

  test('limit is clamped: 0 and negative become 1', async () => {
    expect((await listAttendance(ORG, { limit: 0 })).length).toBe(1)
    expect((await listAttendance(ORG, { limit: -3 })).length).toBe(1)
    expect((await listAttendance(ORG, { limit: 3 })).length).toBe(3)
  })

  test('upsertAttendance inserts, then updates the same (auth0, student, date)', async () => {
    const inserted = await upsertAttendance(ORG, ALICE, '2026-05-01', 'present', 'first')
    expect(inserted).not.toBeNull()
    expect(inserted!.status).toBe('present')
    expect(inserted!.note).toBe('first')

    const updated = await upsertAttendance(ORG, ALICE, '2026-05-01', 'absent', 'sick')
    expect(updated!.id).toBe(inserted!.id) // same row, not a second row
    expect(updated!.status).toBe('absent')
    expect(updated!.note).toBe('sick')

    // session_date comes back as a Date (Bun decodes `date`/`timestamptz`), so a
    // string comparison here would be a lie.
    expect(new Date(updated!.session_date).toISOString().slice(0, 10)).toBe('2026-05-01')

    const rows = await listAttendance(ORG, { studentId: ALICE, from: '2026-05-01' })
    expect(rows.length).toBe(1)
  })

  test('upsertAttendance stores an absent note as NULL rather than the empty string', async () => {
    const row = await upsertAttendance(ORG, BOB, '2026-05-02', 'late')
    expect(row!.note).toBeNull()
    const cleared = await upsertAttendance(ORG, BOB, '2026-05-02', 'late', '')
    expect(cleared!.note).toBeNull()
  })

  test('setAttendanceBatch short-circuits an empty batch without touching the store', async () => {
    // `jsonb_to_recordset`/`values` with no rows is not the point — the point is
    // that no statement is built at all, so there is no `values ` with empty
    // parentheses to hand the server.
    expect(await setAttendanceBatch(ORG, [])).toEqual([])
  })

  test('setAttendanceBatch writes every entry to its OWN student and date', async () => {
    // The placeholder arithmetic is `base = i * 5`, so an off-by-one shifts a
    // whole entry sideways and the batch still succeeds against UNIQUE
    // (auth0_id, student_id, session_date).
    const rows = await setAttendanceBatch(ORG, [
      { studentId: ALICE, sessionDate: '2026-06-01', status: 'present', note: 'a' },
      { studentId: BOB, sessionDate: '2026-06-02', status: 'absent', note: 'b' },
      { studentId: CAROL, sessionDate: '2026-06-03', status: 'excused' },
    ])
    expect(rows.length).toBe(3)
    for (const r of rows) expect(r.auth0_id).toBe(ORG)

    const stored = await listAttendance(ORG, { from: '2026-06-01', to: '2026-06-30' })
    expect(stored.length).toBe(3)
    const byStudent = new Map(stored.map((r) => [r.full_name, r.status]))
    expect(byStudent.get('Alice')).toBe('present')
    expect(byStudent.get('Bob')).toBe('absent')
    expect(byStudent.get('Carol')).toBe('excused')
    const carol = stored.find((r) => r.full_name === 'Carol')!
    expect(carol.note).toBeNull() // omitted note binds NULL, not ''
  })

  test('setAttendanceBatch collapses intra-batch duplicates to the LAST write', async () => {
    // One multi-row ON CONFLICT DO UPDATE cannot touch the same row twice, so the
    // batch collapses first; "last wins" is exactly what the sequential upserts
    // it replaced left standing.
    const rows = await setAttendanceBatch(ORG, [
      { studentId: ALICE, sessionDate: '2026-07-01', status: 'absent', note: 'first' },
      { studentId: ALICE, sessionDate: '2026-07-01', status: 'present', note: 'second' },
      { studentId: ALICE, sessionDate: '2026-07-01', status: 'late', note: 'third' },
    ])
    expect(rows.length).toBe(1)
    expect(rows[0]!.status).toBe('late')
    expect(rows[0]!.note).toBe('third')

    const stored = await listAttendance(ORG, { from: '2026-07-01', to: '2026-07-01' })
    expect(stored.length).toBe(1)
    expect(stored[0]!.status).toBe('late')
  })

  test('setAttendanceBatch updates an EXISTING row rather than duplicating it', async () => {
    const before = await upsertAttendance(ORG, ALICE, '2026-03-01', 'absent', 'changed')
    expect(before!.id).not.toBeNull()
    const rows = await setAttendanceBatch(ORG, [
      { studentId: ALICE, sessionDate: '2026-03-01', status: 'present', note: 'fixed' },
    ])
    expect(rows.length).toBe(1)
    const after = await listAttendance(ORG, { studentId: ALICE, from: '2026-03-01', to: '2026-03-01' })
    expect(after.length).toBe(1)
    expect(after[0]!.id).toBe(before!.id)
    expect(after[0]!.status).toBe('present')
    expect(after[0]!.note).toBe('fixed')
  })

  test('deleteAttendance removes only the exact (org, student, date) triple', async () => {
    expect(await deleteAttendance(ORG, ALICE, '2026-03-02')).toBe(true)
    expect(await deleteAttendance(ORG, ALICE, '2026-03-02')).toBe(false)
    // The wrong date, a date that exists for a DIFFERENT student, and the wrong
    // org all miss — the delete is keyed on the whole triple, not on the date.
    expect(await deleteAttendance(ORG, ALICE, '2026-03-05')).toBe(false)
    expect(await deleteAttendance(ORG, CAROL, '2026-03-02')).toBe(false)
    expect(await deleteAttendance(OTHER, ALICE, '2026-03-01')).toBe(false)

    expect((await listAttendance(ORG)).length).toBe(5)
    expect((await listAttendance(OTHER)).length).toBe(1)
  })

  test('attendanceSummary counts every status and computes the rate', async () => {
    // present 3 (Alice x1, Bob 03-02, Carol 04-01), late 1, absent 1, excused 1
    const summary = await attendanceSummary(ORG)
    expect(summary.total_records).toBe(6)
    expect(summary.present).toBe(3)
    expect(summary.late).toBe(1)
    expect(summary.absent).toBe(1)
    expect(summary.excused).toBe(1)
    // (present + late) / total = 4/6
    expect(summary.attendance_rate).toBeCloseTo(66.7, 1)
  })

  test('attendanceSummary reports a NULL rate for an empty period, not a 0%', async () => {
    // "0%" and "no sessions" are different answers, and only one of them is a
    // rate. The CASE guards on count(*) = 0.
    const summary = await attendanceSummary(ORG, { from: '2027-01-01', to: '2027-01-31' })
    expect(summary.total_records).toBe(0)
    expect(summary.attendance_rate).toBeNull()
  })

  test('attendanceSummary honours the student filters and the scope list', async () => {
    expect((await attendanceSummary(ORG, { studentId: ALICE })).total_records).toBe(2)
    expect((await attendanceSummary(ORG, { studentIds: [CAROL] })).total_records).toBe(2)
    // An EMPTY scope is a coach who sees nobody: zeros, not the org's numbers.
    const none = await attendanceSummary(ORG, { studentIds: [] })
    expect(none.total_records).toBe(0)
    expect(none.attendance_rate).toBeNull()
  })

  test('attendanceSummary is org-scoped', async () => {
    expect((await attendanceSummary(OTHER)).total_records).toBe(1)
    expect((await attendanceSummary('auth0|attlive-nobody')).total_records).toBe(0)
  })

  test('a 100% period reports 100, not a rounding artifact', async () => {
    await setAttendanceBatch(ORG, [
      { studentId: ALICE, sessionDate: '2026-08-01', status: 'present' },
      { studentId: BOB, sessionDate: '2026-08-01', status: 'late' },
    ])
    const summary = await attendanceSummary(ORG, { from: '2026-08-01', to: '2026-08-31' })
    expect(summary.total_records).toBe(2)
    expect(summary.attendance_rate).toBe(100)
  })
})