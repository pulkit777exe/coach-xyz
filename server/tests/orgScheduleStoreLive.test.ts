import { beforeEach, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  createScheduleEvent,
  deleteScheduleEvent,
  getScheduleEvent,
  listSchedule,
  updateScheduleEvent,
} from '../src/lib/org/schedule'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Schedule data layer: the live SQL, and the writes nothing else reaches ────
//
// The uncovered half of this module is the WRITE path (`createScheduleEvent`,
// `updateScheduleEvent`, `deleteScheduleEvent`) plus the team-scope filter, and
// all three are the class AGENTS.md says no fixture can catch: each one is a
// dynamically-built statement whose column list, per-column cast list and bind
// values are assembled in JS. Nothing but a real Postgres can see whether the
// assembly produced valid SQL.
//
// Two live facts are pinned here, both already paid for once:
//
//  1. `updateScheduleEvent` builds `set ${k} = $n${colCasts[k] ?? ''}` — and a
//     blanket `?? '::text'` default makes Postgres 42804 on any column it
//     forgets, because there is no assignment cast from text to timestamptz. The
//     web ALWAYS sends starts_at, so editing any event 500'd outright. A case
//     that only ever sent `title` would sail straight past it.
//  2. `team_id` binds through `uuidArrayLiteral`, and an EMPTY scoped list binds
//     NULL (a raw `[]` reaches Postgres as '' — not a valid uuid[] literal) so an
//     unassigned coach keeps the club calendar and loses every team row. `null`
//     and `[]` must stay distinguishable or that coach sees the whole org.
//
// Live Postgres, and this file spawns nothing — see the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file.

const ORG = 'auth0|schedlive-org'
const OTHER = 'auth0|schedlive-other'
const TEAM_A = '9a5c0001-0000-4000-8000-0000000000a1'
const TEAM_B = '9a5c0001-0000-4000-8000-0000000000a2'
const OTHER_TEAM = '9a5c0001-0000-4000-8000-0000000000b1'

// The connection `useLiveTestDb` lends the suite, captured from `seed`. Every
// case below re-seeds, so a case that asserts "the write changed nothing" cannot
// pass because a previous case left a row behind.
//
// NOTE no delete here spells `in (${[a, b]})`: Bun binds a JS array as
// comma-joined TEXT, so that form produces one long literal that matches nothing —
// and a delete that quietly deletes nothing looks exactly like a clean seed.
let db: SQL | null = null

const resetRows = async (conn: SQL) => {
  await conn`delete from schedule_events where auth0_id = ${ORG} or auth0_id = ${OTHER}`
  // schedule_events.team_id carries a real FK to teams(id) on delete cascade, so
  // the teams have to exist before the team-keyed fixtures do.
  await conn`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${OTHER_TEAM}::uuid)`
  await conn`
    insert into teams (id, org_auth0_id, name, sport)
    values
      (${TEAM_A}::uuid, ${ORG}, 'Team A', 'basketball'),
      (${TEAM_B}::uuid, ${ORG}, 'Team B', 'basketball'),
      (${OTHER_TEAM}::uuid, ${OTHER}, 'Other team', 'soccer');
  `
  await conn`
    insert into schedule_events (auth0_id, title, event_type, starts_at, ends_at, location, status, team_id)
    values
      (${ORG}, 'Club practice', 'practice', '2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z', 'Gym', 'scheduled', null),
      (${ORG}, 'Team A match', 'match', '2026-03-02T10:00:00Z', '2026-03-02T12:00:00Z', null, 'scheduled', ${TEAM_A}::uuid),
      (${ORG}, 'Team B match', 'match', '2026-03-03T10:00:00Z', null, 'Pitch', 'scheduled', ${TEAM_B}::uuid),
      (${ORG}, 'Late fixture', 'other', '2026-04-01T10:00:00Z', null, null, 'completed', null),
      (${OTHER}, 'Other org club', 'practice', '2026-03-01T10:00:00Z', null, null, 'scheduled', null);
  `
}

const drop = async (id: string) => {
  await db!`delete from schedule_events where id = ${id}::uuid`
}

const titles = (rows: { title: string }[]): string[] => rows.map((r) => r.title).sort()

describeLiveDb('schedule_events: scope, dynamic writes, and the per-column cast list', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await conn`delete from schedule_events where auth0_id = ${ORG} or auth0_id = ${OTHER}`
      await conn`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid, ${OTHER_TEAM}::uuid)`
    },
  })

  beforeEach(async () => {
    await resetRows(db!)
  })

  test('an org-wide list (no scope) sees every event, club and team alike', async () => {
    const rows = await listSchedule(ORG)
    expect(titles(rows)).toEqual(['Club practice', 'Late fixture', 'Team A match', 'Team B match'])
  })

  test("the list is org-scoped: another org's calendar is never visible", async () => {
    const rows = await listSchedule(ORG)
    expect(rows.some((r) => r.auth0_id === OTHER)).toBe(false)
    expect(titles(await listSchedule(OTHER))).toEqual(['Other org club'])
  })

  test('a scoped caller sees the club fixture AND its own team, never another team', async () => {
    // team_id is NULL-or-mine: a club-level fixture is everyone's, a team row is
    // the team's. Testing team_id alone would hide the club calendar.
    const rows = await listSchedule(ORG, { teamIds: [TEAM_A] })
    expect(titles(rows)).toEqual(['Club practice', 'Late fixture', 'Team A match'])
    expect(rows.some((r) => r.team_id === TEAM_B)).toBe(false)
  })

  test('an EMPTY scope is not org-wide: an unassigned coach keeps only club rows', async () => {
    // [] binds NULL, so `team_id = any(NULL::uuid[])` matches no team row while
    // `team_id is null` still matches. Collapsing [] into undefined would hand
    // this coach the whole org calendar.
    const rows = await listSchedule(ORG, { teamIds: [] })
    expect(titles(rows)).toEqual(['Club practice', 'Late fixture'])
  })

  test('from/to bound starts_at inclusively', async () => {
    expect(titles(await listSchedule(ORG, { from: '2026-03-02T00:00:00Z' }))).toEqual([
      'Late fixture',
      'Team A match',
      'Team B match',
    ])
    expect(titles(await listSchedule(ORG, { to: '2026-03-02T23:59:59Z' }))).toEqual([
      'Club practice',
      'Team A match',
    ])
  })

  test('limit is clamped, never trusted: 0 becomes 1 and a huge value caps', async () => {
    expect((await listSchedule(ORG, { limit: 0 })).length).toBe(1)
    expect((await listSchedule(ORG, { limit: -5 })).length).toBe(1)
    expect((await listSchedule(ORG, { limit: 2 })).length).toBe(2)
    expect((await listSchedule(ORG, { limit: 999_999 })).length).toBe(4)
  })

  test('getScheduleEvent is org-scoped and distinguishes missing from foreign', async () => {
    const club = (await listSchedule(ORG)).find((r) => r.title === 'Club practice')!
    expect((await getScheduleEvent(ORG, club.id))?.title).toBe('Club practice')
    // Unscoped by design — the refusal is the route's decision (403 beside its
    // capability gate), so "not yours" has to stay a null rather than a hole.
    expect(await getScheduleEvent(OTHER, club.id)).toBeNull()
    expect(await getScheduleEvent(ORG, '9a5c0001-0000-4000-8000-0000000000ff')).toBeNull()
  })

  test('createScheduleEvent writes every supplied column', async () => {
    const created = await createScheduleEvent(ORG, {
      title: 'New fixture',
      event_type: 'match',
      starts_at: '2026-05-01T18:00:00Z',
      ends_at: '2026-05-01T20:00:00Z',
      location: 'Stadium',
      description: 'Cup round',
      status: 'scheduled',
      team_id: TEAM_A,
    })
    expect(created).not.toBeNull()
    expect(created!.title).toBe('New fixture')
    expect(created!.event_type).toBe('match')
    // Bun decodes a `timestamptz` column to a Date, so this is a Date and the
    // string form would be a lie (the localeCompare family in AGENTS.md).
    expect(new Date(created!.starts_at).toISOString()).toBe('2026-05-01T18:00:00.000Z')
    expect(new Date(created!.ends_at!).toISOString()).toBe('2026-05-01T20:00:00.000Z')
    expect(created!.team_id).toBe(TEAM_A)
    expect(created!.auth0_id).toBe(ORG)

    await drop(created!.id)
  })

  test('createScheduleEvent omits empty/null/undefined columns so the DDL defaults apply', async () => {
    const created = await createScheduleEvent(ORG, {
      title: 'Defaults',
      starts_at: '2026-05-02T18:00:00Z',
      location: null,
      description: '',
      team_id: undefined,
    })
    expect(created).not.toBeNull()
    expect(created!.event_type).toBe('practice') // DDL default
    expect(created!.status).toBe('scheduled') // DDL default
    expect(created!.location).toBeNull()
    expect(created!.description).toBeNull()
    expect(created!.team_id).toBeNull()

    await drop(created!.id)
  })

  test('createScheduleEvent lets the CHECK reject an unknown event_type', async () => {
    await expect(
      createScheduleEvent(ORG, {
        title: 'Bad',
        event_type: 'scrimmage',
        starts_at: '2026-05-03T10:00:00Z',
      }),
    ).rejects.toThrow()
  })

  test('updateScheduleEvent accepts the timestamp columns the web always sends', async () => {
    // THE regression this pins: the timestamps fell through to a `::text`
    // default, and Postgres has no assignment cast from text to timestamptz, so
    // every edit the web performs 500'd with 42804. Sending only `title` would
    // never notice.
    const created = await createScheduleEvent(ORG, {
      title: 'Editable',
      starts_at: '2026-05-04T10:00:00Z',
    })
    const updated = await updateScheduleEvent(ORG, created!.id, {
      title: 'Renamed',
      starts_at: '2026-05-05T11:00:00Z',
      ends_at: '2026-05-05T13:00:00Z',
    })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Renamed')
    expect(new Date(updated!.starts_at).toISOString()).toBe('2026-05-05T11:00:00.000Z')
    expect(new Date(updated!.ends_at!).toISOString()).toBe('2026-05-05T13:00:00.000Z')

    await drop(created!.id)
  })

  test("updateScheduleEvent casts team_id as ::uuid and treats '' as 'no team'", async () => {
    const created = await createScheduleEvent(ORG, {
      title: 'Reassign me',
      starts_at: '2026-05-06T10:00:00Z',
      team_id: TEAM_A,
    })
    const moved = await updateScheduleEvent(ORG, created!.id, { team_id: TEAM_B })
    expect(moved!.team_id).toBe(TEAM_B)

    // `''` is not a uuid, so the value layer maps it to NULL — "unassign" rather
    // than a 22P02 on a field the roster form sends empty.
    const unassigned = await updateScheduleEvent(ORG, created!.id, { team_id: '' })
    expect(unassigned!.team_id).toBeNull()

    await drop(created!.id)
  })

  test('updateScheduleEvent with no recognised column still bumps updated_at and returns the row', async () => {
    const created = await createScheduleEvent(ORG, {
      title: 'Untouched',
      starts_at: '2026-05-07T10:00:00Z',
    })
    const updated = await updateScheduleEvent(ORG, created!.id, { not_a_column: 'x' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Untouched')
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created!.updated_at).getTime(),
    )

    await drop(created!.id)
  })

  test("updateScheduleEvent is org-scoped: another org's event is not found", async () => {
    const club = (await listSchedule(ORG)).find((r) => r.title === 'Club practice')!
    expect(await updateScheduleEvent(OTHER, club.id, { title: 'Hijacked' })).toBeNull()
    expect((await getScheduleEvent(ORG, club.id))!.title).toBe('Club practice')
  })

  test('deleteScheduleEvent reports true only for a row it actually removed', async () => {
    const created = await createScheduleEvent(ORG, {
      title: 'Disposable',
      starts_at: '2026-05-08T10:00:00Z',
    })
    expect(await deleteScheduleEvent(ORG, created!.id)).toBe(true)
    expect(await deleteScheduleEvent(ORG, created!.id)).toBe(false)
    // Org-scoped: the other org cannot remove it either, and is told "not found".
    const club = (await listSchedule(ORG)).find((r) => r.title === 'Club practice')!
    expect(await deleteScheduleEvent(OTHER, club.id)).toBe(false)
    expect(await getScheduleEvent(ORG, club.id)).not.toBeNull()
  })
})