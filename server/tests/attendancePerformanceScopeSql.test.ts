import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests, withHistoryStore } from '../src/lib/historyStore'
import { attendanceSummary, listAttendance } from '../src/lib/org/attendance'
import {
  getStudentPerformanceSeries,
  getStudentTrends,
  listPerformance,
} from '../src/lib/org/performance'
import { uuidArrayLiteral } from '../src/lib/org/scope'

// ── Student scope in SQL ─────────────────────────────────────────────────────
// The route tests (attendancePerformanceScope.test.ts) prove the handlers ask
// `visibleStudentIds`; this file proves the ids they hand over actually reach
// Postgres, and reach it with a binding that survives it.
//
// Two hazards, both about what Bun puts on the wire for `= any(?::uuid[])`:
//   - a raw JS array is sent as comma-joined text and the cast fails (22P02),
//     so a non-empty scope must go through `uuidArrayLiteral`;
//   - `[]` is sent as '', which is not a valid uuid[] literal at all, so an
//     empty scope must bind NULL.
// Both halves of the predicate are what make the seam's `null` / `[]`
// distinction work under SQL's three-valued logic:
//   org-wide  → `not false or …`  → TRUE, the second operand is never consulted
//   scoped    → `not true  or …`  → FALSE/NULL, and WHERE drops NULL
// so `null` ids (org-wide) return every row and `[]` (sees nobody) returns none.

const ORG = 'auth0|scope-sql-probe'
const TEAM_A = '00000000-0000-4000-8000-00000000000a'
const TEAM_B = '00000000-0000-4000-8000-00000000000b'
const STUDENT_A = '00000000-0000-4000-8000-0000000000a1'
const STUDENT_B = '00000000-0000-4000-8000-0000000000b1'
const LITERAL_A = `{${STUDENT_A}}`
const LITERAL_AB = `{${STUDENT_A},${STUDENT_B}}`

const hasDb = Boolean(process.env.DATABASE_URL)

type Query = { sql: string; values: unknown[] }

let queries: Query[] = []
let restore: (() => void) | null = null

/**
 * Swap in the recording stub. Idempotent on purpose: the store seam is a single
 * module-level slot, so a second install inside one test would leave the first
 * restore orphaned and hand a dead stub to whatever runs next.
 */
const useRecordingStore = (): void => {
  queries = []
  if (restore) return
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Record data queries only: `ensureInitialized` replays the schema DDL and
    // its information_schema idempotency probe through the same connection on
    // every swap.
    const sql = strings.join(' ')
    if (/^\s*select/i.test(sql) && !sql.includes('information_schema')) {
      queries.push({ sql: strings.join('?'), values })
    }
    return []
  }) as unknown as SQL
  restore = setHistoryStoreConnectionForTests(
    Object.assign(tag, {
      connect: async () => {},
      unsafe: async () => [],
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
 * id list (`not ${scoped} or … = any(${param}::uuid[])`) — and the flag is the
 * only boolean in these queries, so it can be located unambiguously.
 */
const scopeBinding = (query: Query): { scoped: unknown; ids: unknown } => {
  const flag = query.values.findIndex((value) => typeof value === 'boolean')
  expect(flag, `no scope predicate bound in: ${query.sql}`).toBeGreaterThan(-1)
  expect(query.sql).toMatch(/not \? or [\w.]*student_id = any\(\?::uuid\[\]\)/)
  return { scoped: query.values[flag], ids: query.values[flag + 1] }
}

const lastQuery = (): Query => {
  expect(queries.length).toBeGreaterThan(0)
  return queries[queries.length - 1]
}

describe('attendance queries carry the student scope', () => {
  test('a scoped list binds the uuid array literal and flags the predicate on', async () => {
    useRecordingStore()
    await listAttendance(ORG, { studentIds: [STUDENT_A] })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: true, ids: LITERAL_A })
  })

  test("an empty scope binds NULL, never [] (Bun would send that as '')", async () => {
    useRecordingStore()
    await listAttendance(ORG, { studentIds: [] })
    const bound = scopeBinding(lastQuery())
    expect(bound.scoped).toBe(true)
    expect(bound.ids).toBeNull()
  })

  test('org-wide (null) leaves the predicate inert', async () => {
    useRecordingStore()
    await listAttendance(ORG, { studentIds: null })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: false, ids: null })
  })

  test('an unset filter (the /api/me and data-export callers) is inert too', async () => {
    useRecordingStore()
    await listAttendance(ORG)
    expect(scopeBinding(lastQuery())).toEqual({ scoped: false, ids: null })
  })

  test('the summary is scoped exactly like the list', async () => {
    useRecordingStore()
    await attendanceSummary(ORG, { studentIds: [STUDENT_A, STUDENT_B] })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: true, ids: LITERAL_AB })

    queries = []
    await attendanceSummary(ORG, { studentIds: [] })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: true, ids: null })

    queries = []
    await attendanceSummary(ORG, { studentIds: null })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: false, ids: null })
  })

  test('the other filters still bind alongside the scope', async () => {
    useRecordingStore()
    await listAttendance(ORG, {
      from: '2026-03-01',
      to: '2026-03-31',
      studentId: STUDENT_B,
      studentIds: [STUDENT_A],
    })
    const query = lastQuery()
    expect(query.values).toEqual([
      ORG,
      '2026-03-01',
      '2026-03-01',
      '2026-03-31',
      '2026-03-31',
      STUDENT_B,
      STUDENT_B,
      true,
      LITERAL_A,
    ])
  })
})

describe('performance queries carry the student scope', () => {
  test('listPerformance binds the scope', async () => {
    useRecordingStore()
    await listPerformance(ORG, STUDENT_A, { studentIds: [STUDENT_A] })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: true, ids: LITERAL_A })

    queries = []
    await listPerformance(ORG, STUDENT_A, { studentIds: [] })
    expect(scopeBinding(lastQuery())).toEqual({ scoped: true, ids: null })

    queries = []
    await listPerformance(ORG, STUDENT_A)
    expect(scopeBinding(lastQuery())).toEqual({ scoped: false, ids: null })
  })

  test('the series narrows BOTH halves of the timeline', async () => {
    useRecordingStore()
    await getStudentPerformanceSeries(ORG, STUDENT_A, { studentIds: [STUDENT_A] })
    // analysis_history (form scores) + the nested manual-metrics query.
    expect(queries).toHaveLength(2)
    expect(queries[0].sql).toContain('from analysis_history')
    expect(scopeBinding(queries[0])).toEqual({ scoped: true, ids: LITERAL_A })
    expect(queries[1].sql).toContain('from performance_metrics')
    expect(scopeBinding(queries[1])).toEqual({ scoped: true, ids: LITERAL_A })
  })

  test('an empty scope reaches the series as NULL on both queries', async () => {
    useRecordingStore()
    await getStudentPerformanceSeries(ORG, STUDENT_A, { studentIds: [] })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(scopeBinding(query)).toEqual({ scoped: true, ids: null })
    }
  })

  test('trends pass the scope through to the series', async () => {
    useRecordingStore()
    await getStudentTrends(ORG, STUDENT_A, { studentIds: [STUDENT_A] })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(scopeBinding(query)).toEqual({ scoped: true, ids: LITERAL_A })
    }
  })

  test('an org-wide caller costs no scope narrowing', async () => {
    useRecordingStore()
    await getStudentTrends(ORG, STUDENT_A)
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(scopeBinding(query)).toEqual({ scoped: false, ids: null })
    }
  })

  test('the bound literal is what the seam builds', () => {
    expect(uuidArrayLiteral([STUDENT_A])).toBe(LITERAL_A)
    expect(uuidArrayLiteral([STUDENT_A, STUDENT_B])).toBe(LITERAL_AB)
  })
})

// ── Live Postgres (requires DATABASE_URL) ────────────────────────────────────
// A recording stub can only prove what was bound; only the server can prove the
// `::uuid[]` cast accepts it. One student per team, and every read must come
// back with exactly the rows that scope allows.
;(hasDb ? describe : describe.skip)('attendance + performance scope against live Postgres', () => {
  const seed = async (db: SQL) => {
    await db`delete from performance_metrics where auth0_id = ${ORG}`
    await db`delete from attendance where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
    await db`
      insert into students (id, auth0_id, full_name, team_id, status) values
        (${STUDENT_A}::uuid, ${ORG}, 'Scope A', ${TEAM_A}::uuid, 'active'),
        (${STUDENT_B}::uuid, ${ORG}, 'Scope B', ${TEAM_B}::uuid, 'active');
    `
    await db`
      insert into attendance (auth0_id, student_id, session_date, status) values
        (${ORG}, ${STUDENT_A}::uuid, '2026-03-02'::date, 'present'),
        (${ORG}, ${STUDENT_B}::uuid, '2026-03-02'::date, 'absent');
    `
    await db`
      insert into performance_metrics (auth0_id, student_id, metric_key, metric_value, measured_at) values
        (${ORG}, ${STUDENT_A}::uuid, 'sprint_time', 7, now()),
        (${ORG}, ${STUDENT_B}::uuid, 'sprint_time', 9, now());
    `
  }

  const cleanup = async (db: SQL) => {
    await db`delete from performance_metrics where auth0_id = ${ORG}`
    await db`delete from attendance where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
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

  test('attendance list and summary see only the scoped student', async () => {
    await withSeededStore(async () => {
      const records = await listAttendance(ORG, { studentIds: [STUDENT_A] })
      expect(records.map((r) => r.student_id)).toEqual([STUDENT_A])
      const summary = await attendanceSummary(ORG, { studentIds: [STUDENT_A] })
      expect(summary.total_records).toBe(1)
      expect(summary.present).toBe(1)
    })
  }, 60000)

  test('an empty scope list returns nothing at all', async () => {
    await withSeededStore(async () => {
      expect(await listAttendance(ORG, { studentIds: [] })).toEqual([])
      const summary = await attendanceSummary(ORG, { studentIds: [] })
      expect(summary.total_records).toBe(0)
      expect(summary.attendance_rate).toBeNull()
    })
  }, 60000)

  test('org-wide callers still see the whole org', async () => {
    await withSeededStore(async () => {
      const records = await listAttendance(ORG, { studentIds: null })
      expect(records.map((r) => r.student_id).sort()).toEqual([STUDENT_A, STUDENT_B])
      expect((await listAttendance(ORG)).length).toBe(2)
    })
  }, 60000)

  test('performance metrics and trends see only the scoped student', async () => {
    await withSeededStore(async () => {
      const metrics = await listPerformance(ORG, STUDENT_A, { studentIds: [STUDENT_A] })
      expect(metrics.map((m) => m.student_id)).toEqual([STUDENT_A])
      expect(await listPerformance(ORG, STUDENT_A, { studentIds: [] })).toEqual([])

      const series = await getStudentPerformanceSeries(ORG, STUDENT_A, { studentIds: [STUDENT_A] })
      expect(series.map((p) => p.metric_value)).toEqual([7])
      expect(await getStudentTrends(ORG, STUDENT_A, { studentIds: [] })).toEqual([])
    })
  }, 60000)
})
