import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { attendanceWindow } from '../src/routes/org/attendance'
import { MAX_ORG_LIST_ROWS, isDate, readListLimit } from '../src/lib/orgValidate'
import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── /api/me/attendance and /api/me/performance are bounded ───────────────────
// `GET /api/me/attendance` read `from`/`to` straight off the query string with no
// validation and passed no limit at all. Both reach a cast inside the query, and
// both had the wrong default:
//
//   1. `from`/`to` are bare `YYYY-MM-DD` dates reaching a `::date` cast, so
//      `?from=garbage` raised 22007 and surfaced as a 500 INTERNAL_ERROR — a
//      client error reported as an outage, for any linked player. The sibling
//      `/api/me/schedule` had exactly this defect and was fixed by validating at
//      the boundary; this route is the second instance, and the fix is the SAME
//      helper (`attendanceWindow`, now exported) rather than a third copy of the
//      predicate.
//   2. No `limit`. `listAttendance` resolves an absent limit to SQL NULL, which is
//      UNLIMITED — so every player hub load pulled the player's entire attendance
//      history.
//
// `/api/me/performance` is the same defect in the same file with a different
// cast (`::timestamptz`, via `getStudentPerformanceSeries`), so it takes the same
// treatment with the instant-shaped reader `scheduleWindow`.
//
// The window is NOT anchored at now here, unlike `/api/me/schedule`: this query
// orders `session_date desc`, so a cap keeps the most recent rows, and attendance
// is backward-looking — pinning `from` to today would drop every past session.
// The `list` assertion below pins that ordering so the reasoning stays checked.
//
// The probe runs a fresh process per case (its `mock.module` stubs must not leak)
// and records the statement the data layer actually built.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'meAttendanceBoundsProbe.ts')

type Statement = { sql: string; values: unknown[] }

type ProbeResult = {
  case: string
  path: string
  status: number
  body: { code?: string; message?: string; layer?: string; retryable?: boolean } | null
  expectList: boolean
  list: Statement[]
}

const runProbe = async (probeCase: string): Promise<ProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ME_ATT_CASE = probeCase
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<ProbeResult>(proc.stdout)
}

const invalidRequest = (message: string) => ({
  code: 'INVALID_REQUEST',
  message,
  layer: 'server',
  retryable: false,
})

// ── The window is validated at the boundary ───────────────────────────────────

describe('a malformed attendance window is a 400, not a cast failure', () => {
  test('garbage, a blank value, a slashed date and an instant are all refused', async () => {
    for (const probeCase of ['garbageFrom', 'blankFrom', 'garbageTo', 'instantFrom']) {
      const result = await runProbe(probeCase)
      expect(result.status, probeCase).toBe(400)
      expect(result.body, probeCase).toEqual(invalidRequest('Invalid attendance filter'))
      // The list must not run at all: a refusal that has already read the table is
      // not a refusal, and the 22007 came from inside the query.
      expect(result.list, probeCase).toEqual([])
    }
  })

  test('the residual: a well-formed IMPOSSIBLE date still reaches the cast', async () => {
    // `isDate` is deliberately format-only and pinned that way
    // (tests/orgValidate.test.ts: "calendar validity is left to the DB"), so
    // `?to=2026-13-45` is accepted here exactly as it is on the org route this
    // reader is shared with, and Postgres raises 22007 on the cast. Recorded, not
    // fixed: tightening `isDate` would change every date-validated route at once,
    // which is a decision for whoever owns that contract.
    const result = await runProbe('impossibleTo')
    expect(result.status).toBe(200)
    expect(result.list[0]!.values).toContain('2026-13-45')
    expect(isDate('2026-13-45')).toBe(true)
  })

  test('the same window reader the org routes use is what answers here', async () => {
    // Not a second predicate: if `/api/me/attendance` grows its own, this is the
    // assertion that notices.
    expect(attendanceWindow(new URL('http://x/api/me/attendance'))).toEqual({
      ok: true,
      from: undefined,
      to: undefined,
      studentId: undefined,
    })
    expect(attendanceWindow(new URL('http://x/api/me/attendance?from=2026-03-01')).ok).toBe(true)
    expect(
      attendanceWindow(new URL('http://x/api/me/attendance?from=2026-03-01T00:00:00Z')).ok,
    ).toBe(false)
    expect(attendanceWindow(new URL('http://x/api/me/attendance?to=')).ok).toBe(false)
  })

  test('a malformed studentId is refused rather than ignored', () => {
    expect(attendanceWindow(new URL('http://x/?studentId=not-a-uuid')).ok).toBe(false)
    expect(
      attendanceWindow(new URL('http://x/?studentId=00000000-0000-4000-8000-0000000000a1')).ok,
    ).toBe(true)
  })
})

// ── Every call is capped ─────────────────────────────────────────────────────

describe('the list is capped even when the caller sends nothing', () => {
  test('a bare read binds a real limit', async () => {
    const result = await runProbe('bare')
    expect(result.status).toBe(200)
    expect(result.list.length).toBe(1)
    const bound = result.list[0]!.values
    // `limit` is the LAST placeholder: locate it by position, never by type — a
    // type-based locator is invalidated by the next filter this query grows.
    expect(bound.at(-1)).toBe(MAX_ORG_LIST_ROWS)
    expect(bound.at(-1)).not.toBeNull()
    // No `from` bound is invented: attendance history is backward-looking, and
    // `order by session_date desc` means the cap keeps the newest page.
    const dates = bound.filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}/.test(v))
    expect(dates).toEqual([])
  })

  test('the ordering is what makes an unanchored cap honest', () => {
    // The reason there is no "anchor at now" here, asserted on the query the probe
    // recorded rather than in a comment: newest first ⇒ a cap truncates the OLDEST
    // history, which is the opposite of `/api/me/schedule`'s ascending fixture list.
    return runProbe('bare').then((result) => {
      expect(result.list[0]!.sql).toContain('order by a.session_date desc')
      expect(result.list[0]!.sql).not.toContain('order by a.session_date asc')
    })
  })

  test('an explicit limit is honoured and unusable ones take the ceiling', async () => {
    const explicit = await runProbe('explicitLimit')
    expect(explicit.status).toBe(200)
    expect(explicit.list[0]!.values.at(-1)).toBe(7)

    // `?limit=abc`, `?limit=-5` and `?limit=1e999` (Infinity, which would reach
    // Postgres as "no limit") are "not a usable number", not a crash and not a floor.
    for (const probeCase of ['nonsenseLimit', 'negativeLimit', 'hugeLimit']) {
      const result = await runProbe(probeCase)
      expect(result.status, probeCase).toBe(200)
      expect(result.list[0]!.values.at(-1), probeCase).toBe(MAX_ORG_LIST_ROWS)
    }
  })

  test('a valid window is passed through to the query', async () => {
    const result = await runProbe('window')
    expect(result.status).toBe(200)
    expect(result.list[0]!.values).toContain('2026-03-01')
    expect(result.list[0]!.values).toContain('2026-03-31')
  })

  test('the route pins the linked player, ignoring any studentId the caller sends', async () => {
    // Self-scoped read: the linked player row is the only student it may answer
    // with, so a well-formed foreign id must not become the filter.
    const result = await runProbe('otherStudent')
    expect(result.status).toBe(200)
    const studentIds = result.list[0]!.values.filter(
      (v): v is string => typeof v === 'string' && v.startsWith('00000000'),
    )
    expect(studentIds.every((id) => id !== '00000000-0000-4000-8000-0000000000ff')).toBe(true)
    expect(studentIds.length).toBeGreaterThan(0)
  })
})

// ── /api/me/performance: the same defect, the other cast ──────────────────────

describe('a malformed performance window is a 400 too', () => {
  test('garbage and blank are refused before the series query runs', async () => {
    for (const probeCase of ['perfGarbageFrom', 'perfBlankFrom']) {
      const result = await runProbe(probeCase)
      expect(result.status, probeCase).toBe(400)
      expect(result.body, probeCase).toEqual(invalidRequest('Invalid performance filter'))
      expect(result.list, probeCase).toEqual([])
    }
  })

  test('a valid instant window still reaches the series read', async () => {
    const bare = await runProbe('perfBare')
    expect(bare.status).toBe(200)
    const windowed = await runProbe('perfWindow')
    expect(windowed.status).toBe(200)
  })
})

// ── The reader itself ────────────────────────────────────────────────────────

describe('readListLimit is the same door the org list routes use', () => {
  test('the ceiling, not "no limit", is what an absent parameter means', () => {
    const at = (q: string) => new URL(`http://localhost/api/me/attendance${q}`)
    expect(readListLimit(at(''))).toBe(MAX_ORG_LIST_ROWS)
    expect(readListLimit(at('?limit=25'))).toBe(25)
    expect(readListLimit(at(`?limit=${MAX_ORG_LIST_ROWS + 1}`))).toBe(MAX_ORG_LIST_ROWS)
  })
})
