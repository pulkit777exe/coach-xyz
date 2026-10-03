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

const runProbe = async (probeCase: string): Promise<ProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ME_SCHED_CASE = probeCase
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
