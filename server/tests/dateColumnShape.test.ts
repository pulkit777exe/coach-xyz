import { expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { withHistoryStoreOrThrow } from '../src/lib/historyStore'
import { listAttendance, upsertAttendance } from '../src/lib/org/attendance'
import {
  createMatch,
  createSeason,
  getMatch,
  getSeason,
  listMatches,
  listSeasons,
} from '../src/lib/org/compete'
import { createStudent, getStudent, listStudents } from '../src/lib/org/students'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── A `date` column must leave the data layer as `YYYY-MM-DD` ────────────────
//
// Three columns declare `string` and are really Postgres `date`, which **Bun
// decodes to a `Date`** — the same lie AGENTS.md records for `measured_at`. The
// damage is not confined to the server: `JSON.stringify` renders the Date as a
// full ISO instant (`"2008-04-01T00:00:00.000Z"`), and that string is what the
// web receives.
//
// Three consumer failures follow, and none is visible from a fixture because
// each needs the real decoder:
//   - `components/org/StudentFormDialog.tsx` binds `date_of_birth` / `joined_on`
//     to `<input type="date">`, whose `value` must be exactly `YYYY-MM-DD`. An
//     ISO instant is not a valid date input, so the field renders BLANK for any
//     player who has a date on file.
//   - that same dialog's submit does `String(value)` and the server re-validates
//     with `isDate` (`/^\d{4}-\d{2}-\d{2}$/`), so editing such a player sends
//     the instant back, fails validation, and the save 400s with
//     "date_of_birth must be YYYY-MM-DD".
//   - `components/org/AttendanceGrid.tsx` keys its status and note maps on the
//     EXACT string (`${studentId}|${session_date}`) while building its own keys
//     from the date picker's bare `YYYY-MM-DD`. An instant on one side and a bare
//     day on the other means every lookup MISSES, so recorded sessions render as
//     blank cells — the worst of the three, because it silently shows the coach
//     an empty grid rather than an error.
//
// Asserting on the raw column value would pass under the bug — the column IS a
// Date, faithfully. The assertion that matters is on what leaves the data layer
// as JSON, because JSON is the contract.

const ORG = 'auth0|student-date-shape-probe'
const EMAIL = 'dated-player@probe.local'

const STUDENT = '00000000-0000-4000-8000-0000000000c9'
const SESSION = '2026-03-02'

const seed = async (db: SQL) => {
  await db`delete from attendance where auth0_id = ${ORG}`
  // Delete the student BY ID, not only by org: the row is keyed by a primary key
  // another org's probe may have left behind, and a delete scoped to this org
  // cannot see it. See tests/fixtureIdCollisions.test.ts.
  await db`delete from students where id = ${STUDENT}::uuid`
  await db`delete from students where auth0_id = ${ORG}`
  await db`
    insert into students (id, auth0_id, full_name, email, date_of_birth, joined_on, status)
    values (
      ${STUDENT}::uuid, ${ORG}, 'Dated Player', ${EMAIL},
      '2008-04-01'::date, '2026-01-15'::date, 'active'
    );
  `
  await db`
    insert into attendance (auth0_id, student_id, session_date, status)
    values (${ORG}, ${STUDENT}::uuid, ${SESSION}::date, 'present');
  `
}

const cleanup = async (db: SQL) => {
  await db`delete from attendance where auth0_id = ${ORG}`
  await db`delete from students where id = ${STUDENT}::uuid`
  await db`delete from students where auth0_id = ${ORG}`
}

describeLiveDb('student date columns serialise as YYYY-MM-DD (live Postgres)', () => {
  useLiveTestDb({ seed, cleanup })

  test('getStudent returns bare dates, and its JSON has no time component', async () => {
    const student = await getStudent(ORG, await idOf())
    expect(student?.date_of_birth).toBe('2008-04-01')
    expect(student?.joined_on).toBe('2026-01-15')

    // The wire shape is the actual contract. If this ever carries a "T", a
    // `<input type="date">` renders blank and the round-tripped save 400s.
    const wire = JSON.parse(JSON.stringify(student)) as Record<string, unknown>
    expect(wire.date_of_birth).toBe('2008-04-01')
    expect(wire.joined_on).toBe('2026-01-15')
    expect(String(wire.date_of_birth)).not.toContain('T')
  })

  test('listStudents normalises the same way — not just the by-id read', async () => {
    // The roster is the page that renders the table, and it is a different
    // query from getStudent, so a fix in one place would not cover the other.
    const rows = await listStudents(ORG)
    const row = rows.find((r) => r.email === EMAIL)
    expect(row?.date_of_birth).toBe('2008-04-01')
    expect(row?.joined_on).toBe('2026-01-15')
  })

  test('a created student comes back dated too', async () => {
    // createStudent is an `insert … returning *`, so it hands the decoder's
    // output straight to the response body without passing a read path.
    const created = await createStudent(ORG, {
      full_name: 'Fresh Dated',
      email: 'fresh-dated@probe.local',
      date_of_birth: '2010-02-03',
      joined_on: '2026-03-04',
    })
    expect(created?.date_of_birth).toBe('2010-02-03')
    expect(created?.joined_on).toBe('2026-03-04')
    await withHistoryStoreOrThrow(async (db) => {
      await db`delete from students where email = ${'fresh-dated@probe.local'}`
    })
  })

  test('a null date stays null rather than becoming an epoch day', async () => {
    await withHistoryStoreOrThrow(async (db) => {
      await db`delete from students where email = ${'undated@probe.local'}`
      await db`
        insert into students (auth0_id, full_name, email, status)
        values (${ORG}, 'Undated', ${'undated@probe.local'}, 'active');
      `
    })
    const rows = await listStudents(ORG)
    const row = rows.find((r) => r.email === 'undated@probe.local')
    expect(row?.date_of_birth).toBeNull()
    await withHistoryStoreOrThrow(async (db) => {
      await db`delete from students where email = ${'undated@probe.local'}`
    })
  })
})

const idOf = async (): Promise<string> => {
  const rows = await withHistoryStoreOrThrow(async (db) => {
    return db<{ id: string }[]>`
      select id from students where auth0_id = ${ORG} and email = ${EMAIL};
    `
  })
  const id = rows?.[0]?.id
  if (!id) throw new Error('seed row missing — did beforeAll run?')
  return id
}

describeLiveDb('attendance session_date serialises as YYYY-MM-DD (live Postgres)', () => {
  useLiveTestDb({ seed, cleanup })

  test('a recorded session reads back as the bare day it was written as', async () => {
    const records = await listAttendance(ORG)
    expect(records).toHaveLength(1)
    expect(records[0]?.session_date).toBe(SESSION)

    // The exact-match contract, stated as the grid states it: this string is
    // concatenated into a Map key against the picker's `YYYY-MM-DD`. An instant
    // here means the key never matches and the cell renders blank.
    const wire = JSON.parse(JSON.stringify(records[0])) as Record<string, unknown>
    expect(String(wire.session_date)).toBe(SESSION)
  })

  test('a freshly written session also reads back bare — the upsert returns a row', async () => {
    // `upsertAttendance` is `… returning *`, so it hands the decoder's output
    // straight to the response body without passing through a list read.
    const record = await upsertAttendance(ORG, STUDENT, '2026-03-09', 'late', null)
    expect(record?.session_date).toBe('2026-03-09')
  })
})

// The same lie in a third and fourth table. `seasons.starts_on` / `ends_on` and
// `matches.match_on` are `date` columns typed `string | null`, and `TeamsClient`
// renders `match_on` with no formatting at all
// (`[match.match_on, match.location].filter(Boolean).join(' · ')`), so a club's
// fixture list read `2026-09-10T00:00:00.000Z · Home ground`. Less severe than the
// attendance case — verbose rather than blank — and fixed the same way, because
// "a `date` column leaves the data layer as YYYY-MM-DD" is one rule and three
// tables either got it or did not.
describeLiveDb('season and match dates serialise as YYYY-MM-DD (live Postgres)', () => {
  useLiveTestDb({ seed, cleanup })

  test('a season round-trips its bounds as bare days', async () => {
    const created = await createSeason(ORG, {
      name: 'Autumn',
      starts_on: '2026-09-01',
      ends_on: '2026-11-30',
    })
    expect(created?.starts_on).toBe('2026-09-01')
    expect(created?.ends_on).toBe('2026-11-30')
    // The by-id read is a different query from the create, so cover both.
    expect((await getSeason(ORG, created!.id))?.starts_on).toBe('2026-09-01')
    const listed = await listSeasons(ORG)
    expect(listed.find((x) => x.id === created!.id)?.ends_on).toBe('2026-11-30')
  })

  test('a match round-trips its date as a bare day', async () => {
    const created = await createMatch(ORG, {
      opponent: 'Riverside',
      match_on: '2026-09-10',
      location: 'Home ground',
    })
    expect(created?.match_on).toBe('2026-09-10')
    expect((await getMatch(ORG, created!.id))?.match_on).toBe('2026-09-10')
    expect((await listMatches(ORG)).find((m) => m.id === created!.id)?.match_on).toBe('2026-09-10')
  })

  test('an unscheduled match stays null rather than becoming an epoch day', async () => {
    const created = await createMatch(ORG, { opponent: 'TBD' })
    expect(created?.match_on).toBeNull()
    const listed = await listMatches(ORG)
    expect(listed.find((m) => m.id === created!.id)?.match_on).toBeNull()
  })

  test('the wire shape carries no time component', async () => {
    const created = await createMatch(ORG, { opponent: 'Wire', match_on: '2026-09-10' })
    const wire = JSON.parse(JSON.stringify(created)) as Record<string, unknown>
    expect(wire.match_on).toBe('2026-09-10')
    expect(String(wire.match_on)).not.toContain('T')
  })
})
