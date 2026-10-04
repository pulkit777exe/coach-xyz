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
import { describeLiveDb, useLiveTestDb } from './liveDb'

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
 * id list (`not ${scoped} or … = any(${param}::uuid[])`).
 *
 * Locate them by *position*, not by type. The previous version searched for the
 * only boolean in the values array, which assumed no other predicate bound one.
 * That assumption died the moment `toBound` added a day flag to the same
 * queries: `findIndex(typeof === 'boolean'` then returned the period bound's
 * flag and read the id list out of the next slot, so all five performance cases
 * failed while attendance's kept passing. These queries may bind any number of
 * booleans; the `?` the regex matches is a fixed offset, so counting the
 * placeholders before it indexes the values array exactly.
 */
const SCOPE_PREDICATE = /not \? or [\w.]*student_id = any\(\?::uuid\[\]\)/

const scopeBinding = (query: Query): { scoped: unknown; ids: unknown } => {
  const match = SCOPE_PREDICATE.exec(query.sql)
  expect(match, `no scope predicate bound in: ${query.sql}`).not.toBeNull()
  // `values` is parallel to the `?` placeholders, so the count of placeholders
  // preceding the predicate is the index of its first bound value.
  const flag = query.sql.slice(0, match?.index ?? 0).split('?').length - 1
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
      // No limit passed → bound null (LIMIT NULL is unlimited by design).
      null,
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

// ── Live Postgres (needs a configured database) ─────────────────────────────
// A recording stub can only prove what was bound; only the server can prove the
// `::uuid[]` cast accepts it. One student per team, and every read must come
// back with exactly the rows that scope allows.
describeLiveDb('attendance + performance scope against live Postgres', () => {
  useLiveTestDb()

  const cleanup = async (db: SQL) => {
    // analysis_history is keyed by server_job_id, not by an id column, and the
    // series test seeds one for ORG. It has to go or the "trends" case above
    // would see a second point and fail on a row it never created.
    await db`delete from analysis_history where auth0_id = ${ORG}`
    await db`delete from performance_metrics where auth0_id = ${ORG}`
    await db`delete from attendance where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
    // Also by id: `students_pkey` is a GLOBAL primary key, so an org-scoped delete
    // cannot see a row another org inserted under the same uuid, and the inserts
    // below then die on a unique violation naming a table this file never mentions.
    // Same failure `studentImportTeam.test.ts` had. Caught by fixtureIdCollisions.
    await db`delete from students where id in (${STUDENT_A}::uuid, ${STUDENT_B}::uuid)`
  }

  const seed = async (db: SQL) => {
    // Starts from `cleanup`, not just from the students row. analysis_history has
    // no FK to students, so a run that died between the series test's insert and
    // its `finally` leaves a row nothing below would remove — and the next run's
    // `toHaveLength(1)` then sees two points and fails on residue it never
    // created. Invisible while this suite only ran against a long-lived Neon
    // database where an interrupted run was rare; routine against the ephemeral
    // CI database. Same reason the probe files pre-clean FK-less tables by
    // student id.
    await cleanup(db)
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

  // The upper period bound is where a fixture is blind: the whole defect is how
  // Postgres casts the bound, and only the server can show that. `to` arrives in
  // two shapes — `period_end` is always a bare `YYYY-MM-DD` (the report path,
  // isDate-validated), and the series route may pass a full instant — and the
  // two used to share one `<= to::timestamptz` comparison, which is midnight for a
  // bare date. So a report for 1st..30th dropped everything recorded on the 30th
  // while the attendance half of the same report (`session_date <= to::date`)
  // kept the day. The bound is now exclusive and shifts by a day only when a day
  // was named; these assertions pin both halves of that, including the negative
  // case, so a blanket "widen to end of day" regression cannot pass.
  test('a bare `to` date keeps that whole day; an instant stays exact', async () => {
    await withSeededStore(async () => {
      await withHistoryStore(async (db) => {
        await db`
          insert into performance_metrics (auth0_id, student_id, metric_key, metric_value, measured_at)
          values (${ORG}, ${STUDENT_A}::uuid, 'bound_probe', 42, '2026-03-02 18:00:00+00'::timestamptz);
        `
      })

      const bound = async (from?: string, to?: string) =>
        (
          await listPerformance(ORG, STUDENT_A, {
            metricKey: 'bound_probe',
            from,
            to,
          })
        ).length

      // A bare date names a whole day, so the 18:00 measurement is inside it.
      expect(await bound(undefined, '2026-03-02')).toBe(1)
      // The previous day ends before it.
      expect(await bound(undefined, '2026-03-01')).toBe(0)
      // `from` is a bare date too and stays inclusive at midnight.
      expect(await bound('2026-03-02', '2026-03-02')).toBe(1)
      expect(await bound('2026-03-03', '2026-03-04')).toBe(0)

      // A full instant is an instant: earlier excludes, later includes. Without
      // these the "day" widening could be unconditional and still pass above.
      expect(await bound(undefined, '2026-03-02T12:00:00Z')).toBe(0)
      expect(await bound(undefined, '2026-03-02T19:00:00Z')).toBe(1)

      // No bound at all is still no bound.
      expect(await bound()).toBe(1)
    })
  }, 60000)

  // The same bound on the other half of the series: `requested_at` on
  // analysis_history, which is the query reports read for form scores. It is a
  // separate predicate in a separate statement, so it needs its own evidence —
  // the previous version of this test asserted an empty series both before and
  // after the fix and therefore proved nothing.
  test('the series upper bound keeps the final day of a period', async () => {
    await withSeededStore(async () => {
      await withHistoryStore(async (db) => {
        // summary_json is bound as an object, never JSON.stringify'd: on Bun's
        // prepared-statement path the string form is stored as a jsonb string,
        // and `(summary_json->>'form_score')` then yields NULL and the row drops
        // out of the query for a reason that has nothing to do with the bound.
        await db`
          insert into analysis_history (
            server_job_id, engine_job_id, model, complete, summary_json,
            auth0_id, student_id, requested_at
          ) values (
            ${'bound-probe-job'}, ${'bound-probe-engine'}, ${'gemini'}, true,
            ${{ form_score: 8.5 }}::jsonb,
            ${ORG}, ${STUDENT_A}::uuid, '2026-03-02 18:00:00+00'::timestamptz
          );
        `
      })

      const formScores = async (from?: string, to?: string) =>
        (await getStudentPerformanceSeries(ORG, STUDENT_A, { from, to })).filter(
          (p) => p.metric_key === 'form_score',
        )

      // A bare `to` names a whole day, so an 18:00 analysis on the final day is
      // inside a 1st..2nd period. This is the row the old `<=` dropped.
      expect(await formScores('2026-03-01', '2026-03-02')).toHaveLength(1)
      expect(await formScores('2026-03-01', '2026-03-01')).toHaveLength(0)
      // A full instant is still exact, so the same day can be excluded.
      expect(await formScores('2026-03-01', '2026-03-02T12:00:00Z')).toHaveLength(0)
      expect(await formScores('2026-03-01', '2026-03-02T19:00:00Z')).toHaveLength(1)
    })
  }, 60000)
})
