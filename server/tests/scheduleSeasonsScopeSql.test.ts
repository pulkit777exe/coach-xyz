import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  ensureInitialized,
  setHistoryStoreConnectionForTests,
  withHistoryStore,
} from '../src/lib/historyStore'
import { getScheduleEvent, listSchedule } from '../src/lib/org/schedule'
import { listSeasons } from '../src/lib/org/compete'
import { uuidArrayLiteral } from '../src/lib/org/scope'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Schedule/season scope in SQL, and the column that carries it ─────────────
// scheduleScope.test.ts proves the handlers ask for the right scope; this file
// proves what reaches Postgres, because a route-level fixture cannot.
//
// The hazard is the same one the roster sweep already hit: Bun sends a raw JS
// array as comma-joined text, so `= any(${ids}::uuid[])` dies with 22P02
// `malformed array literal`, and `[]` is sent as '' — not a uuid[] literal at
// all. Only the server can settle that, which is why the live half below is not
// optional decoration. The bind must also stay `null` vs `[]`-distinct:
//   org-wide → `not false or …` → TRUE, the second operand is never consulted
//   scoped   → `not true  or …` → FALSE/NULL, and WHERE drops NULL
// The hermetic half pins the wire format; the live half runs the real thing,
// including the new DDL twice.

const ORG = 'auth0|schedule-scope-sql'
const TEAM_A = '00000000-0000-4000-8000-00000000000a'
const TEAM_B = '00000000-0000-4000-8000-00000000000b'
const EVENT_A = '00000000-0000-4000-8000-0000000000a1'
const EVENT_B = '00000000-4000-4000-8000-0000000000b1'
const EVENT_CLUB = '00000000-0000-4000-8000-0000000000c1'
const SEASON_EMPTY = '00000000-0000-4000-8000-0000000000d1'
const SEASON_CLUB = '00000000-0000-4000-8000-0000000000d2'
const SEASON_A = '00000000-0000-4000-8000-0000000000d3'
const SEASON_B = '00000000-0000-4000-8000-0000000000d4'

const LITERAL_A = `{${TEAM_A}}`
const LITERAL_AB = `{${TEAM_A},${TEAM_B}}`

type Statement = { sql: string; values: unknown[] }

let statements: Statement[] = []
/**
 * The column lists spliced in through `db.unsafe(...)` inside a tagged template.
 *
 * They are NOT visible in `statements`: a nested unsafe reaches a stub as a
 * placeholder (`select ? from …`) with the lazy query object in `values`, so the
 * projection can only be read here — and the fact it is a separate channel is
 * exactly why "pin the column set" needs its own recorder rather than a regex on
 * the statement.
 */
let unsafeCalls: string[] = []
let restore: (() => void) | null = null

/**
 * Record every statement the seam executes, DDL included — the column and index
 * this change adds are asserted on the text that produced them.
 *
 * Idempotent on purpose: the store seam is a single module-level slot, so a
 * second install inside one test would leave the first restore orphaned.
 */
const useRecordingStore = (): void => {
  statements = []
  unsafeCalls = []
  if (restore) return
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Joined with `?` so the recorded text reads as the statement Postgres
    // parses — one placeholder per interpolation — and the predicate can be
    // matched structurally as well as by its bound values.
    statements.push({ sql: strings.join('?'), values })
    return []
  }) as unknown as SQL
  restore = setHistoryStoreConnectionForTests(
    Object.assign(tag, {
      connect: async () => {},
      unsafe: async (sql: string, values: unknown[] = []) => {
        if (typeof sql === 'string') unsafeCalls.push(sql.replace(/\s+/g, ' ').trim())
        statements.push({ sql, values })
        return []
      },
      close: async () => {},
    }) as unknown as SQL,
  )
}

afterEach(() => {
  restore?.()
  restore = null
})

/**
 * The scope predicate binds two consecutive values — the `scoped` flag then the
 * team list (`not ${scoped} or … = any(${param}::uuid[])`) — and the flag is the
 * only boolean in these queries, so it can be located unambiguously.
 */
const scopeBinding = (query: Statement): { scoped: unknown; ids: unknown } => {
  const flag = query.values.findIndex((value) => typeof value === 'boolean')
  expect(flag, `no scope predicate bound in: ${query.sql}`).toBeGreaterThan(-1)
  return { scoped: query.values[flag], ids: query.values[flag + 1] }
}

const lastDataStatement = (): Statement => {
  const data = statements.filter((s) => /^\s*select/i.test(s.sql))
  expect(data.length).toBeGreaterThan(0)
  return data[data.length - 1]!
}

// ── listSchedule ─────────────────────────────────────────────────────────────

describe('the schedule list carries the team scope', () => {
  test('a scoped list binds the uuid array literal and flags the predicate on', async () => {
    useRecordingStore()
    await listSchedule(ORG, { teamIds: [TEAM_A] })
    const query = lastDataStatement()
    // The predicate text itself, not just the bound value: a dropped
    // `team_id is null` would silently hide the club calendar from every coach.
    expect(query.sql).toMatch(/not \? or team_id is null or team_id = any\(\?::uuid\[\]\)/)
    expect(scopeBinding(query)).toEqual({ scoped: true, ids: LITERAL_A })
  })

  test("an empty team list binds NULL, never [] (Bun would send that as '')", async () => {
    useRecordingStore()
    await listSchedule(ORG, { teamIds: [] })
    const bound = scopeBinding(lastDataStatement())
    expect(bound.scoped).toBe(true)
    expect(bound.ids).toBeNull()
  })

  test('org-wide (undefined) leaves the predicate inert', async () => {
    useRecordingStore()
    await listSchedule(ORG)
    expect(scopeBinding(lastDataStatement())).toEqual({ scoped: false, ids: null })

    statements = []
    await listSchedule(ORG, { teamIds: undefined })
    expect(scopeBinding(lastDataStatement())).toEqual({ scoped: false, ids: null })
  })

  test('the date window still binds alongside the scope, and the row cap last', async () => {
    // The pre-existing callers (`/api/me/schedule`, the data export) pass only
    // from/to, so their bind must not shift. Positions, not types: `values` is
    // parallel to the placeholders, and index 0 is the spliced column list (the
    // nested `db.unsafe` reaches a stub as a lazy query object, not as text).
    useRecordingStore()
    await listSchedule(ORG, {
      from: '2026-03-01',
      to: '2026-03-31',
      teamIds: [TEAM_A, TEAM_B],
    })
    const values = lastDataStatement().values
    expect(values.slice(1)).toEqual([
      ORG,
      '2026-03-01',
      '2026-03-01',
      '2026-03-31',
      '2026-03-31',
      true,
      LITERAL_AB,
      // `LIMIT NULL` is UNLIMITED in Postgres, so an absent limit must bind a real
      // number here or "no cap" is what production does. The route supplies the
      // number; this call deliberately does not, so the null IS the convention
      // (`undefined → null`, clamped when present) the routes exist to cover.
      null,
    ])
  })

  test('a limit is clamped, and an absurd one cannot reach Postgres', async () => {
    useRecordingStore()
    await listSchedule(ORG, { limit: 25 })
    expect(lastDataStatement().values.at(-1)).toBe(25)

    statements = []
    await listSchedule(ORG, { limit: 0 })
    expect(lastDataStatement().values.at(-1)).toBe(1)

    statements = []
    await listSchedule(ORG, { limit: Number.POSITIVE_INFINITY })
    expect(lastDataStatement().values.at(-1)).toBe(10000)
  })

  test('the list spells its columns out instead of `select *`', async () => {
    // `select *` is how `team_id` arrived on this read at all — it came with the
    // ADR-0002 add column rather than by decision. Pinning the list makes it a
    // contract and makes the next `add column` a deliberate act.
    useRecordingStore()
    await listSchedule(ORG)
    expect(lastDataStatement().sql).not.toContain('select *')
    // Found by what it contains, not by position: the recorder also sees
    // `ensureInitialized`'s CHECK-value lists, so `at(-1)` is only accidentally
    // right today.
    const columns = unsafeCalls.find((call) => call.includes('team_id')) ?? ''
    for (const column of [
      'id',
      'auth0_id',
      'title',
      'event_type',
      'starts_at',
      'ends_at',
      'location',
      'description',
      'status',
      // The scope predicate reads this column, so it MUST be projected: dropping
      // it from the select would not narrow anything, it would just hide the
      // dimension the whole team-scope feature is built on.
      'team_id',
      'created_at',
      'updated_at',
    ]) {
      expect(columns, `missing column: ${column}`).toContain(column)
    }
  })

  test('the by-id load the writes gate on is unscoped', async () => {
    // Unscoped on purpose: the route decides 403 vs 404, so a scoped read here
    // would collapse "missing" into "not yours".
    useRecordingStore()
    await getScheduleEvent(ORG, EVENT_A)
    const query = lastDataStatement()
    expect(query.sql).toContain('limit 1')
    expect(query.values).toEqual([ORG, EVENT_A])
  })
})

// ── listSeasons ──────────────────────────────────────────────────────────────

describe('the season list carries the team scope', () => {
  test('a scoped list binds the literal and keeps both arms of the rule', async () => {
    useRecordingStore()
    await listSeasons(ORG, { teamIds: [TEAM_A] })
    const query = lastDataStatement()
    expect(scopeBinding(query)).toEqual({ scoped: true, ids: LITERAL_A })
    const sql = query.sql.replace(/\s+/g, ' ')
    // Arm 1: no matches at all → visible. Arm 2: at least one visible match,
    // where a team-less (club) match counts. Dropping either hides fixtures the
    // coach is meant to plan around.
    expect(sql).toMatch(
      /not exists \(\s*select 1 from matches m where [^)]*m\.season_id = s\.id\s*\)/,
    )
    expect(sql).toContain('m.team_id is null or m.team_id = any(?::uuid[])')
  })

  test('an empty team list binds NULL, and org-wide binds no list at all', async () => {
    useRecordingStore()
    await listSeasons(ORG, { teamIds: [] })
    expect(scopeBinding(lastDataStatement())).toEqual({ scoped: true, ids: null })

    statements = []
    await listSeasons(ORG)
    expect(scopeBinding(lastDataStatement())).toEqual({ scoped: false, ids: null })
  })
})

// ── The DDL that carries the dimension ───────────────────────────────────────

describe('the team column is additive and idempotent', () => {
  test('the alter and the index are both `if not exists`', async () => {
    useRecordingStore()
    await ensureInitialized()
    // Twice in a row is the property that matters: `ensureInitialized` is the
    // single DDL owner and runs on every process start, so a second run must be
    // a no-op rather than an error.
    await ensureInitialized()

    const text = statements.map((s) => s.sql.replace(/\s+/g, ' ').trim().toLowerCase())
    const alter = text.find((sql) => sql.includes('alter table schedule_events'))
    expect(alter).toBeDefined()
    expect(alter).toContain('add column if not exists team_id uuid')
    expect(alter).toContain('references teams (id)')
    // Nullable on purpose: an event with no team is a club-level fixture, and
    // every row that predates the column is one by definition (no backfill).
    expect(alter).not.toContain('not null')

    const index = text.find((sql) => sql.includes('idx_schedule_team_id'))
    expect(index).toContain('create index if not exists')
    expect(index).toContain('on schedule_events (team_id)')
  })

  test('the bound literal is what the seam builds', () => {
    expect(uuidArrayLiteral([TEAM_A])).toBe(LITERAL_A)
    expect(uuidArrayLiteral([TEAM_A, TEAM_B])).toBe(LITERAL_AB)
  })
})

// ── Live Postgres (needs a configured database) ─────────────────────────────
describeLiveDb('schedule + season scope against live Postgres', () => {
  useLiveTestDb()

  const cleanup = async (db: SQL) => {
    await db`delete from matches where org_auth0_id = ${ORG}`
    await db`delete from seasons where org_auth0_id = ${ORG}`
    await db`delete from schedule_events where auth0_id = ${ORG}`
    await db`delete from teams where org_auth0_id = ${ORG}`
  }

  const seed = async (db: SQL) => {
    await cleanup(db)
    await db`
      insert into teams (id, org_auth0_id, name, sport) values
        (${TEAM_A}::uuid, ${ORG}, 'Scope A', 'soccer'),
        (${TEAM_B}::uuid, ${ORG}, 'Scope B', 'soccer');
    `
    await db`
      insert into schedule_events (id, auth0_id, title, event_type, starts_at, team_id) values
        (${EVENT_A}::uuid, ${ORG}, 'Team A practice', 'practice', '2026-03-01T10:00:00Z'::timestamptz, ${TEAM_A}::uuid),
        (${EVENT_B}::uuid, ${ORG}, 'Team B practice', 'practice', '2026-03-02T10:00:00Z'::timestamptz, ${TEAM_B}::uuid),
        (${EVENT_CLUB}::uuid, ${ORG}, 'Club open day', 'practice', '2026-03-03T10:00:00Z'::timestamptz, null);
    `
    await db`
      insert into seasons (id, org_auth0_id, name, created_at) values
        (${SEASON_EMPTY}::uuid, ${ORG}, 'Unscheduled', '2026-01-04T00:00:00Z'::timestamptz),
        (${SEASON_CLUB}::uuid, ${ORG}, 'Club season', '2026-01-03T00:00:00Z'::timestamptz),
        (${SEASON_A}::uuid, ${ORG}, 'Team A season', '2026-01-02T00:00:00Z'::timestamptz),
        (${SEASON_B}::uuid, ${ORG}, 'Team B season', '2026-01-01T00:00:00Z'::timestamptz);
    `
    await db`
      insert into matches (org_auth0_id, season_id, team_id, opponent, match_on) values
        (${ORG}, ${SEASON_CLUB}::uuid, null, 'Rivals', '2026-03-05'::date),
        (${ORG}, ${SEASON_A}::uuid, ${TEAM_A}::uuid, 'Rivals', '2026-03-06'::date),
        (${ORG}, ${SEASON_B}::uuid, ${TEAM_B}::uuid, 'Rivals', '2026-03-07'::date);
    `
  }

  const withSeededStore = async <T>(fn: () => Promise<T>): Promise<T> => {
    const seeded = await withHistoryStore(seed)
    if (seeded === null) throw new Error('live seed failed — is DATABASE_URL reachable?')
    try {
      return await fn()
    } finally {
      await withHistoryStore(cleanup)
    }
  }

  test('a scoped list sees its own events plus the club ones', async () => {
    await withSeededStore(async () => {
      const events = await listSchedule(ORG, { teamIds: [TEAM_A] })
      expect(events.map((e) => e.id).sort()).toEqual([EVENT_A, EVENT_CLUB].sort())
      expect(events.map((e) => e.team_id)).toContain(null)
      expect(events.map((e) => e.team_id)).not.toContain(TEAM_B)
    })
  }, 60000)

  test('an empty team list keeps the club calendar and nothing else', async () => {
    await withSeededStore(async () => {
      // The case a raw `[]` bind would have broken (22P02) and a single-armed
      // season filter would have inverted.
      expect((await listSchedule(ORG, { teamIds: [] })).map((e) => e.id)).toEqual([EVENT_CLUB])
      expect((await listSchedule(ORG, { teamIds: [TEAM_A, TEAM_B] })).length).toBe(3)
    })
  }, 60000)

  test('org-wide reads are untouched', async () => {
    await withSeededStore(async () => {
      const all = await listSchedule(ORG)
      expect(all.map((e) => e.id).sort()).toEqual([EVENT_A, EVENT_B, EVENT_CLUB].sort())
      // The date window keeps working beside the new predicate.
      const windowed = await listSchedule(ORG, { from: '2026-03-02T00:00:00Z' })
      expect(windowed.map((e) => e.id).sort()).toEqual([EVENT_B, EVENT_CLUB].sort())
      expect((await getScheduleEvent(ORG, EVENT_B))?.team_id).toBe(TEAM_B)
      expect(await getScheduleEvent(ORG, '00000000-0000-4000-8000-0000000000ff')).toBeNull()
    })
  }, 60000)

  test('a season survives while it holds nothing or something visible', async () => {
    await withSeededStore(async () => {
      const forA = (await listSeasons(ORG, { teamIds: [TEAM_A] })).map((s) => s.id)
      expect(forA).not.toContain(SEASON_B)
      expect(forA.sort()).toEqual([SEASON_EMPTY, SEASON_CLUB, SEASON_A].sort())

      const forNobody = (await listSeasons(ORG, { teamIds: [] })).map((s) => s.id)
      // Both halves of the asymmetry in one assertion: an empty season and a
      // club-fixture season stay, a team season goes — even though
      // `= any(NULL::uuid[])` is NULL rather than false.
      expect(forNobody.sort()).toEqual([SEASON_EMPTY, SEASON_CLUB].sort())

      expect((await listSeasons(ORG)).length).toBe(4)
    })
  }, 60000)

  test('the column, the index and the cascade are really there', async () => {
    await withHistoryStore(async (db) => {
      // Idempotent for real: the DDL has now run at least once against this
      // database (the seed above) and must run again without complaint.
      await ensureInitialized()
      await ensureInitialized()

      const column = await db<{ is_nullable: string; data_type: string }[]>`
        select is_nullable, data_type from information_schema.columns
        where table_name = 'schedule_events' and column_name = 'team_id';
      `
      expect(column[0]?.data_type).toBe('uuid')
      expect(column[0]?.is_nullable).toBe('YES')

      const index = await db<{ indexdef: string }[]>`
        select indexdef from pg_indexes
        where tablename = 'schedule_events' and indexname = 'idx_schedule_team_id';
      `
      expect(index.length).toBe(1)

      const fk = await db<{ confdeltype: string }[]>`
        select c.confdeltype
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.relname = 'schedule_events' and c.contype = 'f'
          and pg_get_constraintdef(c.oid) like '%team_id%';
      `
      // 'c' = cascade: the event belonged to that team. `set null` would have
      // quietly promoted a deleted team's fixtures to the org-wide calendar.
      expect(fk.map((r) => r.confdeltype)).toEqual(['c'])
    })
  }, 60000)

  test('deleting a team takes its events with it', async () => {
    await withSeededStore(async () => {
      // Proves the FK is live rather than merely declared, and that a team-less
      // event (no FK row to cascade through) is untouched by it.
      await withHistoryStore(async (db) => {
        await db`delete from teams where id = ${TEAM_B}::uuid`
      })
      const remaining = (await listSchedule(ORG)).map((e) => e.id)
      expect(remaining.sort()).toEqual([EVENT_A, EVENT_CLUB].sort())
    })
  }, 60000)
})
