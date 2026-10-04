import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { MAX_ORG_LIST_ROWS, readListLimit, scheduleWindow } from '../src/lib/orgValidate'
import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── /api/me/schedule is bounded ───────────────────────────────────────────────
// This read was the one org list nobody had bounded. `GET /api/me/schedule` read
// `from`/`to` straight off the query string with no validation and no limit, and
// the web's player hub calls it with NO parameters at all — so every player hub
// load pulled the owning club's entire fixture history, ordered oldest first.
//
// Three separate defects, so three groups of assertions:
//   1. `from`/`to` are instants reaching a `::timestamptz` cast, so garbage is a
//      400 (it was a 500: 22007). The probe sends the raw string, unvalidated.
//   2. A row cap is bound on EVERY call, including the bare one. `LIMIT NULL` is
//      unlimited in Postgres, so "no limit" is not a bound.
//   3. A bare call is anchored at now. With no window the read is all-time and
//      ordered ascending, so a cap would keep the OLDEST page — the hub filters to
//      upcoming fixtures and would show nothing at all. The default window is what
//      makes the cap truncate nothing.
//
// The probe runs a fresh process per case (its `mock.module` stubs must not leak)
// and records the statement the data layer actually built.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'meScheduleBoundsProbe.ts')

type ProbeResult = {
  case: string
  status: number
  body: { code?: string; message?: string; layer?: string; retryable?: boolean } | null
  expectList: boolean
  list: { sql: string; values: unknown[] }[]
}

const runProbe = async (probeCase: string, playerTeam?: string): Promise<ProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ME_SCHED_CASE = probeCase
  if (playerTeam !== undefined) env.ME_SCHED_PLAYER_TEAM = playerTeam
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<ProbeResult>(proc.stdout)
}

const invalidRequest = {
  code: 'INVALID_REQUEST',
  message: 'Invalid schedule filter',
  layer: 'server',
  retryable: false,
}

// ── The window is validated at the boundary ───────────────────────────────────

describe('a malformed schedule window is a 400, not a cast failure', () => {
  test('garbage, a blank value and an impossible date are all refused', async () => {
    for (const probeCase of ['garbageFrom', 'blankFrom', 'garbageTo']) {
      const result = await runProbe(probeCase)
      expect(result.status, probeCase).toBe(400)
      // The handler answers the error descriptor directly, not wrapped.
      expect(result.body, probeCase).toEqual(invalidRequest)
      // The list must not run at all: a refusal that has already read the table is
      // not a refusal, and the 22007 came from inside the query.
      expect(result.list, probeCase).toEqual([])
    }
  })

  test('the pure window reader agrees with the route', () => {
    const at = (q: string) => new URL(`http://localhost/api/me/schedule${q}`)
    expect(scheduleWindow(at(''))).toEqual({ ok: true, from: undefined, to: undefined })
    expect(scheduleWindow(at('?from=2026-03-01T00:00:00.000Z'))).toEqual({
      ok: true,
      from: '2026-03-01T00:00:00.000Z',
      to: undefined,
    })
    expect(scheduleWindow(at('?from=')).ok).toBe(false)
    expect(scheduleWindow(at('?to=nope')).ok).toBe(false)
  })
})

// ── Every call is capped ─────────────────────────────────────────────────────

describe('the list is capped even when the caller sends nothing', () => {
  test('a bare read binds a real limit and anchors the window at now', async () => {
    const result = await runProbe('bare')
    expect(result.status).toBe(200)
    expect(result.list.length).toBe(1)
    const bound = result.list[0]!.values
    // `limit` is the LAST placeholder: locate it by position, never by type — a
    // type-based locator is invalidated by the next filter this query grows.
    expect(bound.at(-1)).toBe(MAX_ORG_LIST_ROWS)
    expect(bound.at(-1)).not.toBeNull()
    // And the from bound is present, which is what makes `order by starts_at asc`
    // plus a cap mean "the next N" rather than "the oldest N".
    const from = bound.find(
      (v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
    )
    expect(from, 'no from bound reached the query').toBeDefined()
    const age = Date.now() - new Date(from as string).getTime()
    expect(age).toBeGreaterThanOrEqual(-60_000)
    expect(age).toBeLessThan(60_000)
  })

  test('an explicit limit is honoured and still clamped to the ceiling', async () => {
    const explicit = await runProbe('explicitLimit')
    expect(explicit.status).toBe(200)
    expect(explicit.list[0]!.values.at(-1)).toBe(7)

    // `?limit=abc` and `?limit=-5` are "not a usable number", not a crash and not
    // a floor of 1 row; `?limit=1e999` is Infinity, which must not reach Postgres
    // as "no limit".
    for (const probeCase of ['nonsenseLimit', 'negativeLimit', 'hugeLimit']) {
      const result = await runProbe(probeCase)
      expect(result.status, probeCase).toBe(200)
      expect(result.list[0]!.values.at(-1), probeCase).toBe(MAX_ORG_LIST_ROWS)
    }
  })

  test('an explicit window is passed through untouched', async () => {
    const result = await runProbe('window')
    expect(result.status).toBe(200)
    expect(result.list[0]!.values).toContain('2026-03-01T00:00:00.000Z')
    expect(result.list[0]!.values).toContain('2026-03-31T00:00:00.000Z')
  })
})

// ── The reader itself ────────────────────────────────────────────────────────

describe('readListLimit resolves an absent limit to a real number', () => {
  test('absent, blank and garbage all land on the ceiling', () => {
    const at = (q: string) => new URL(`http://localhost/api/org/x/students${q}`)
    expect(readListLimit(at(''))).toBe(MAX_ORG_LIST_ROWS)
    expect(readListLimit(at('?limit='))).toBe(MAX_ORG_LIST_ROWS)
    expect(readListLimit(at('?limit=abc'))).toBe(MAX_ORG_LIST_ROWS)
    expect(readListLimit(at('?limit=1e999'))).toBe(MAX_ORG_LIST_ROWS)
  })

  test('a usable value passes through and an over-large one is clamped', () => {
    const at = (q: string) => new URL(`http://localhost/api/org/x/students${q}`)
    expect(readListLimit(at('?limit=25'))).toBe(25)
    expect(readListLimit(at(`?limit=${MAX_ORG_LIST_ROWS + 1}`))).toBe(MAX_ORG_LIST_ROWS)
    // A cap must never shrink a list below what the same caller gets by sending
    // nothing: `pickInt` would clamp `?limit=0` to its `min` and answer ONE row.
    expect(readListLimit(at('?limit=0'))).toBe(MAX_ORG_LIST_ROWS)
    expect(readListLimit(at('?limit=-5'))).toBe(MAX_ORG_LIST_ROWS)
  })
})

// ── The read is scoped, and it agrees with its org sibling ───────────────────
//
// `/api/org/:auth0Id/schedule` has always narrowed through `caller.studentScope`
// (`teamIds: caller.studentScope.all ? undefined : caller.studentScope.teamIds`).
// `/api/me/schedule` passed no `teamIds` at all, so it read the owning club's
// ENTIRE calendar: a player on team A saw team B's fixtures, and the same person
// got two different answers from the two schedule routes depending on which one
// the web happened to call.
//
// The assertion is on the BIND, not the rows. The probe's store is a recorder
// that returns `[]`, so both a scoped and an unscoped query answer zero rows — the
// result set cannot distinguish them, and a test that asserted on it would pass
// against the bug. What differs is the `not ? or team_id is null or team_id =
// any(?::uuid[])` predicate and its two values.
//
// Both branches are pinned, because an unassigned player is a real answer rather
// than an absent one: `teamIds: []` yields `scoped = true` with a NULL id list,
// which the predicate resolves to club-wide fixtures ONLY. Passing `[]` is not
// "no filter", and omitting the key is what used to happen.

const SCOPE_TEAM = '00000000-0000-4000-8000-00000000000a'

/** The scope flag and the id list, in bind order, from the recorded statement. */
const scopeBind = (result: ProbeResult): { scoped: unknown; ids: unknown } => {
  const query = result.list[0]
  expect(query, 'no schedule statement recorded').toBeDefined()
  expect(query.sql).toMatch(/not \? or team_id is null or team_id = any\(\?::uuid\[\]\)/)
  const flag = query.sql.slice(0, query.sql.indexOf('not ?')).split('?').length - 1
  return { scoped: query.values[flag], ids: query.values[flag + 1] }
}

describe("the schedule read is narrowed to the viewer's team", () => {
  test('a player on a team sees that team plus the club-wide fixtures', async () => {
    const result = await runProbe('scope.playerTeam', SCOPE_TEAM)
    expect(result.status).toBe(200)
    const bind = scopeBind(result)
    expect(bind.scoped).toBe(true)
    // A uuid ARRAY LITERAL, not a raw array: Bun sends a raw array as
    // comma-joined text and the ::uuid[] cast dies with 22P02.
    expect(bind.ids).toBe(`{${SCOPE_TEAM}}`)
  })

  test('an unassigned player sees club-wide fixtures only', async () => {
    const result = await runProbe('scope.unassigned', '')
    expect(result.status).toBe(200)
    const bind = scopeBind(result)
    expect(bind.scoped).toBe(true)
    // NULL, not `[]`. `[]` would be sent as '' — not a valid uuid[] literal — so
    // `teamScopeFilter` maps the empty list to NULL on purpose.
    expect(bind.ids).toBeNull()
  })

  test('the scoped read is bounded and windowed exactly like the unscoped one', async () => {
    // Narrowing must not have cost the other two guarantees in this file: a cap
    // on every call (LIMIT NULL is unlimited), and an anchor at now for the bare
    // query so a cap cannot keep the oldest page.
    const scoped = await runProbe('scope.playerTeam', SCOPE_TEAM)
    const bare = await runProbe('bare')
    expect(scoped.status).toBe(200)

    // Positional, against a fixed bind order for a fixed statement — the first
    // version searched for the ISO string and matched the wrong slot, because
    // `auth0_id` and `from` are both strings and only one of them ends in "Z" on
    // every run. Order is [columns, auth0_id, from, from, to, to, scoped, ids,
    // limit]; the doubled pair is the `from`/`to` filter, bound twice each.
    const values = scoped.list[0]!.values
    expect(scoped.list[0]?.sql).toBe(bare.list[0]?.sql)
    expect(values[1]).toBe('auth0|coach-1')
    // `from` bound twice and NOT null: the default anchor at now is what makes
    // the cap truncate nothing.
    expect(typeof values[2]).toBe('string')
    expect(values[2]).toBe(values[3])
    expect(values[4]).toBeNull()
    expect(values[5]).toBeNull()
    expect(values.at(-1)).toBeGreaterThan(0)
  })
})
