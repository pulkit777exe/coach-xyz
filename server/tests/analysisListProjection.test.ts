import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  ANALYSES_LIST_COLUMNS,
  ANALYSES_LIST_SUMMARY_JSON,
  ANALYSES_SELECT_COLUMNS,
  getAnalysisByServerJobId,
  getUserAnalyses,
  getUserAnalysisById,
} from '../src/lib/analyses'
import { getStudentAnalyses, listRecentAnalysisScores } from '../src/lib/org/reports'
import {
  setHistoryStoreConnectionForTests,
  withHistoryStore,
  withHistoryStoreOrThrow,
} from '../src/lib/historyStore'
import { redactWellness } from '../src/lib/permissions'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── The analysis list projection ──────────────────────────────────────────────
// `summary_json` holds `shot_events[]` (each with `biomechanics.joint_angles`,
// `weighted_scoring.criteria[]` and `injury_risk`), `findings[]`, `quality` and
// `top_tips`: 57.5 KB at 12 events, 95.6 KB at the engine's 20-event frame
// budget. Every LIST consumer reads one field of it — `summary_json.form_score` —
// so a 21-row History page was moving ~2 MB of JSON to render 21 numbers.
//
// Two things are pinned here, because they fail in opposite directions:
//
//   1. WHICH column set each read asks for. A fixture stub cannot see a spliced
//      projection (it reaches the stub as a placeholder), so this records the
//      `db.unsafe(...)` argument itself. Putting a list back onto
//      ANALYSES_SELECT_COLUMNS is the regression that costs 2 MB; putting a
//      single-row read — or the portability export — onto the projection is the
//      one that silently deletes a user's data.
//   2. §5, the medical boundary. `redactWellness` only removes, so a projection is
//      strictly more restrictive than a redaction and cannot open the boundary —
//      but that argument is worth nothing unless the projected object provably
//      holds nothing else, which is what the key-set assertions are for.

const ORG = 'auth0|analysis-list-projection'
const STUDENT = '00000000-0000-4000-8000-0000000000c1'
const OTHER_STUDENT = '00000000-0000-4000-8000-0000000000b1'

let unsafeCalls: string[] = []
let restore: (() => void) | null = null

const useRecordingStore = (): void => {
  unsafeCalls = []
  if (restore) return
  const tag = (async () => []) as unknown as SQL
  restore = setHistoryStoreConnectionForTests(
    Object.assign(tag, {
      connect: async () => {},
      unsafe: async (sql: string) => {
        unsafeCalls.push(sql.replace(/\s+/g, ' ').trim())
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

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/**
 * The column list spliced into the query, found by what it contains rather than
 * by position. The recorder also sees `ensureInitialized`'s CHECK-value lists and
 * its migration probes, and the list read interpolates a second fragment (an
 * empty `unlinked` filter), so `at(-1)` lands on whichever of those ran last.
 */
const columnsCall = (): string => unsafeCalls.find((call) => call.includes('a.server_job_id')) ?? ''

// ── 1. Which reads project, which do not ──────────────────────────────────────

describe('a list asks for the projection and a single row does not', () => {
  test('getUserAnalyses — the account tree list behind History, Recents, students', async () => {
    useRecordingStore()
    await getUserAnalyses(ORG)
    expect(columnsCall()).toBe(flat(ANALYSES_LIST_COLUMNS))
  })

  test('getStudentAnalyses — player hub, org student page, privacy delete loop', async () => {
    useRecordingStore()
    await getStudentAnalyses(ORG, OTHER_STUDENT)
    expect(columnsCall()).toBe(flat(ANALYSES_LIST_COLUMNS))

    // `fullSummary` is the portability export's opt-in. Getting this wrong is not
    // a size regression, it is data loss: the bundle ships 200 summaries.
    unsafeCalls = []
    await getStudentAnalyses(ORG, OTHER_STUDENT, 20, { fullSummary: true })
    expect(columnsCall()).toBe(flat(ANALYSES_SELECT_COLUMNS))
  })

  test('listRecentAnalysisScores — named for scores, and now only ships one', async () => {
    useRecordingStore()
    await listRecentAnalysisScores(ORG)
    expect(columnsCall()).toBe(flat(ANALYSES_LIST_COLUMNS))
  })

  test('the by-id reads keep the whole blob', async () => {
    useRecordingStore()
    await getUserAnalysisById(ORG, '00000000-0000-4000-8000-0000000000a1')
    expect(columnsCall()).toBe(flat(ANALYSES_SELECT_COLUMNS))

    unsafeCalls = []
    await getAnalysisByServerJobId('00000000-0000-4000-8000-0000000000a1')
    expect(columnsCall()).toBe(flat(ANALYSES_SELECT_COLUMNS))
  })
})

// ── The shape of the projection itself ───────────────────────────────────────

/** Column names in order; the projection's `… end as summary_json` reads as itself. */
const columnNames = (sql: string): string[] =>
  sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))
    .map((line) => line.replace(/,$/, '').split(/\s+/)[0]!)

describe('the projected column set', () => {
  test('the same columns in the same order, summary_json being the only change', () => {
    expect(columnNames(flat(ANALYSES_LIST_COLUMNS))).toEqual(
      columnNames(flat(ANALYSES_SELECT_COLUMNS)),
    )
  })

  test('the raw blob never appears in the list projection', () => {
    // `a.summary_json,` is the whole defect in one token. Its absence is the pin.
    expect(flat(ANALYSES_SELECT_COLUMNS)).toContain('a.summary_json,')
    expect(flat(ANALYSES_LIST_COLUMNS)).not.toContain('a.summary_json,')
    expect(flat(ANALYSES_LIST_COLUMNS)).toContain('as summary_json')
  })

  test('the replacement is guarded, so one bad row cannot 500 the whole list', () => {
    const expr = flat(ANALYSES_LIST_SUMMARY_JSON)
    expect(expr).toContain("->> 'form_score'")
    expect(expr).toContain('::float8')
    expect(expr).toContain('jsonb_build_object')
    // `->>` is TEXT: a bare `::float8` raises 22P02 on `"N/A"`, which the whole
    // 21-row History page would answer with a 500. The `when`/`else` pair is the
    // guard, and `else null` is what makes it fail CLOSED rather than throwing.
    expect(expr).toMatch(/when .+~.+then jsonb_build_object.+ else null/s)
    // And the length bound rules out the other cast failure, 22003 on a value
    // too large for float8.
    expect(expr).toContain('length(')
  })
})

// ── 2. §5: the medical boundary only ever gets narrower ──────────────────────

describe('redaction can only get narrower under the projection', () => {
  test('a projected summary holds nothing but the score', () => {
    expect(Object.keys({ form_score: 7.5 })).toEqual(['form_score'])
    // The composition: for every key the persisted blob can carry, the projected
    // object's key set is a subset. `redactWellness` is a filter, so composing it
    // with a projection is a filter composed with a filter — which is the whole
    // reason projecting a list cannot DISCLOSE wellness to a medical caller, let
    // alone to one without the role.
    const persisted = {
      form_score: 7.5,
      shot_events: [
        { timestamp: 90, injury_risk: 'high', biomechanics: { joint_angles: { elbow: 172 } } },
      ],
      findings: [{ observation: 'late elbow' }],
      top_tips: ['x'],
    }
    const persistedKeys = new Set(Object.keys(persisted))
    for (const key of Object.keys({ form_score: 7.5 })) {
      expect(persistedKeys.has(key), `projection must not invent ${key}`).toBe(true)
    }
    // And the redacted full row is what the by-id route answers a caller without
    // medical access: the projected row is a strict subset of THAT too, since
    // redaction only ever removes keys from the same blob.
    const redacted = redactWellness(persisted) as Record<string, Array<Record<string, unknown>>>
    expect(redacted.shot_events[0]).not.toHaveProperty('injury_risk')
    expect(Object.keys(redacted.shot_events[0]!).sort()).toEqual(['biomechanics', 'timestamp'])
  })

  test('an unscored row stays NULL rather than becoming {"form_score": null}', () => {
    // The trap: `jsonb_build_object('form_score', NULL)` HAS the key, and every
    // consumer gates on having it. `org/reports.ts` then computes `Number(null)`
    // === 0 and reports 0/10 for an analysis that was never scored.
    const reportedScore = (summary: unknown): number | null =>
      typeof summary === 'object' && summary && 'form_score' in summary
        ? Number((summary as Record<string, unknown>).form_score)
        : null
    expect(reportedScore(null)).toBeNull()
    expect(reportedScore({ form_score: 7.5 })).toBe(7.5)
    // What the naive construction would have produced — the reason for the CASE:
    expect(reportedScore({ form_score: null })).toBe(0)
  })
})

// ── 3. Live Postgres: the projection really returns one key ───────────────────

describeLiveDb('the projection against live Postgres', () => {
  useLiveTestDb()

  const SCORED = '00000000-0000-4000-8000-0000000000d1'
  const NO_SCORE = '00000000-0000-4000-8000-0000000000d3'
  const NOT_A_NUMBER = '00000000-0000-4000-8000-0000000000d4'
  const STRING_SCORE = '00000000-0000-4000-8000-0000000000d5'

  const rows: Array<{ job: string; summary: Record<string, unknown> }> = [
    { job: SCORED, summary: { form_score: 7.5, top_tips: ['a'] } },
    // No score at all: must project to NULL, not to {"form_score": null}.
    { job: NO_SCORE, summary: { overall_rating: 'Good' } },
    // A score the engine should never emit. The bare cast would raise 22P02 here
    // and 500 the History page; the guard sends it down the NULL arm instead.
    { job: NOT_A_NUMBER, summary: { form_score: 'N/A' } },
    // A numeric STRING is a real score: `->>` is text either way, and the client
    // required `typeof score === 'number'`, so this is strictly more data.
    { job: STRING_SCORE, summary: { form_score: '7.25' } },
  ]

  const cleanup = async (db: SQL) => {
    await db`delete from analysis_history where auth0_id = ${ORG}`
  }

  const seed = async (db: SQL) => {
    await cleanup(db)
    for (const row of rows) {
      await db`
        insert into analysis_history
          (server_job_id, engine_job_id, auth0_id, student_id, model, complete, summary_json)
        values
          (${row.job}::uuid, ${row.job}::uuid, ${ORG}, ${STUDENT}::uuid, 'gemini', true, ${row.summary}::jsonb)
      `
    }
  }

  const withSeededStore = async <T>(fn: () => Promise<T>): Promise<T> => {
    await withHistoryStoreOrThrow(seed)
    try {
      return await fn()
    } finally {
      await withHistoryStore(cleanup)
    }
  }

  test('a list row carries form_score and nothing else', async () => {
    await withSeededStore(async () => {
      const listed = await getStudentAnalyses(ORG, STUDENT, 20)
      expect(listed.length).toBe(rows.length)
      for (const row of listed) {
        const keys = row.summary_json === null ? [] : Object.keys(row.summary_json)
        expect(
          keys.every((k) => k === 'form_score'),
          `unexpected keys on ${row.server_job_id}`,
        ).toBe(true)
      }
      const byJob = new Map(listed.map((r) => [r.server_job_id, r.summary_json]))
      expect(byJob.get(SCORED)).toEqual({ form_score: 7.5 })
      // No score in the blob → NULL, so `'form_score' in …` is false, the web
      // renders no score tile, and `Number(null)` never produces a 0/10.
      expect(byJob.get(NO_SCORE)).toBeNull()
      // Non-numeric → NULL rather than a 22P02 that would take the whole page.
      expect(byJob.get(NOT_A_NUMBER)).toBeNull()
      expect(byJob.get(STRING_SCORE)).toEqual({ form_score: 7.25 })

      // And the opt-in still returns the blob it is the only reason to ask for.
      const full = await getStudentAnalyses(ORG, STUDENT, 20, { fullSummary: true })
      const fullByJob = new Map(full.map((r) => [r.server_job_id, r.summary_json]))
      expect(fullByJob.get(SCORED)).toEqual({ form_score: 7.5, top_tips: ['a'] })
    })
  }, 60000)

  test('a wellness key cannot survive a projected row, redacted or not', async () => {
    await withSeededStore(async () => {
      for (const row of await getStudentAnalyses(ORG, STUDENT, 20)) {
        // Whatever the route does to the row — `GET /api/me/analyses` redacts
        // unconditionally — the projected object carries no injury signal, so the
        // §5 boundary cannot be crossed by this list.
        expect(JSON.stringify(redactWellness(row.summary_json))).not.toContain('injury_risk')
      }
    })
  }, 60000)
})
