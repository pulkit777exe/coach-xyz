import { describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { hasNumericFormScore, listFormScoreJson, safeFormScore } from '../src/lib/formScoreSql'
import { ANALYSES_LIST_SUMMARY_JSON } from '../src/lib/analyses'
import { compareStudents, getStudentPerformanceSeries } from '../src/lib/org/performance'
import {
  buildReportContent,
  getStudentAnalyses,
  listRecentAnalysisScores,
} from '../src/lib/org/reports'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── One SSOT for "a form_score Postgres can cast" ────────────────────────────
// `summary_json ->> 'form_score'` is TEXT. `(…)::float8` on it raises 22P02 for
// the WHOLE query the moment ONE row's score is `"N/A"`, so a single unscorable
// row anywhere in an org turned a read into a 500 INTERNAL_ERROR — served to
// whichever member happened to ask, including a read-only one. Two sites cast it
// bare (`org/performance.ts`, twice) and a third asked "analyses WITH A SCORE"
// while only testing `is not null`, which admits `"N/A"` and lets
// `Number('N/A')` become `NaN` in a report that is then STORED.
//
// The projection added in 744c417 already had this right for lists, in
// `ANALYSES_LIST_SUMMARY_JSON`. That expression is now `listFormScoreJson` in
// `lib/formScoreSql.ts`, shared with both `org/performance.ts` sites and with
// `listRecentAnalysisScores`'s filter, so "a score" means one thing everywhere.
//
// A fixture cannot prove any of it: it stubs `db` as a plain tag function, so the
// cast never happens. Hence the live-Postgres half below (and, note, a tagged
// template binds an interpolated value as a PARAMETER — the fragments have to
// arrive through `db.unsafe`, which is why these sites read the way they do).

const ORG = 'auth0|form-score-ssot'
const STUDENT = '00000000-0000-4000-8000-0000000000f1'
const OTHER = '00000000-0000-4000-8000-0000000000f2'
const SCORED = '00000000-0000-4000-8000-0000000000f3'
const NOT_A_NUMBER = '00000000-0000-4000-8000-0000000000f4'
const OVERFLOWS = '00000000-0000-4000-8000-0000000000f5'
const NO_SCORE_AT_ALL = '00000000-0000-4000-8000-0000000000f6'

// ── The guard itself ─────────────────────────────────────────────────────────

describe('the form_score guard is total', () => {
  test('it admits a decimal and nothing else, and bounds the length', () => {
    const predicate = hasNumericFormScore('summary_json')
    expect(predicate).toContain("->> 'form_score'")
    expect(predicate).toMatch(/length\(/)
    expect(predicate).toMatch(/<=\s*40/)
    expect(predicate).toContain("~ '^-?[0-9]+([.][0-9]+)?$'")
    // `[.]`, not `\.`: with `standard_conforming_strings = off` a backslash
    // degrades to a wildcard, so `"1x2"` would pass the pattern and reach the cast.
    expect(predicate).not.toContain('\\.')
    // The value expression only casts inside the guard.
    expect(safeFormScore('summary_json')).toMatch(/^case when .+ then .+::float8 else null end$/s)
  })

  test('the list projection IS this module, so there is one spelling', () => {
    expect(ANALYSES_LIST_SUMMARY_JSON.replace(/\s+/g, ' ').trim()).toBe(
      listFormScoreJson('a.summary_json').replace(/\s+/g, ' ').trim(),
    )
  })

  test('no module reintroduces the bare cast', () => {
    // Source-level, because the failure is a 500 that only a real cast can raise.
    // Comments are skipped: the notes that document the trap quote the bad form.
    const src = join(import.meta.dir, '..', 'src')
    // Recursive: `lib/org/performance.ts` is two levels down, and a one-level scan
    // passes vacuously — which is exactly the bug the local-storage sweep had.
    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) return sourceFiles(full)
        return full.endsWith('.ts') ? [full] : []
      })
    // `'form_score'` immediately cast to float8, with or without the closing paren and
    // any spacing: the source writes `->> 'form_score'` with NO space, so a pattern
    // spelled with a space matches nothing and the guard passes vacuously.
    const BARE_CAST = /'form_score'\)?\s*::float8/
    const offenders: string[] = []
    for (const file of sourceFiles(src)) {
      if (file.endsWith('formScoreSql.ts')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trimStart()
          if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('--'))
            return
          if (BARE_CAST.test(line)) {
            offenders.push(`${file.replace(src, 'src')}:${index + 1}  ${line.trim()}`)
          }
        })
    }
    expect(
      offenders,
      'Cast through safeFormScore()/hasNumericFormScore() from lib/formScoreSql.ts. ' +
        "A bare (summary_json->> 'form_score')::float8 raises 22P02 on ONE unscorable " +
        'row and 500s the whole read.\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

// ── Live Postgres: the reads that used to 500 ────────────────────────────────

describeLiveDb('an unscorable analysis does not take its page down', () => {
  const rows: Array<{ job: string; summary: Record<string, unknown> }> = [
    { job: SCORED, summary: { form_score: 7.5 } },
    // The row the bare cast raised 22P02 on.
    { job: NOT_A_NUMBER, summary: { form_score: 'N/A' } },
    // The other failure a cast has: 22003, a value too large for float8.
    { job: OVERFLOWS, summary: { form_score: '9'.repeat(300) } },
    // No score key at all — a different question with the same NULL answer.
    { job: NO_SCORE_AT_ALL, summary: { overall_rating: 'Good' } },
  ]

  const cleanup = async (db: SQL) => {
    await db`delete from analysis_history where auth0_id = ${ORG}`
    await db`delete from students where auth0_id = ${ORG}`
  }

  const seed = async (db: SQL) => {
    // Idempotent: FK-less residue from a red run must not fail the next green one.
    await cleanup(db)
    await db`
      insert into students (id, auth0_id, full_name)
      values (${STUDENT}::uuid, ${ORG}, 'A'), (${OTHER}::uuid, ${ORG}, 'B')
    `
    for (const row of rows) {
      await db`
        insert into analysis_history
          (server_job_id, engine_job_id, auth0_id, student_id, model, complete, summary_json)
        values (${row.job}::uuid, ${`${row.job}-eng`}, ${ORG}, ${STUDENT}::uuid, 'm', true, ${row.summary}::jsonb)
      `
    }
  }

  useLiveTestDb({ seed, cleanup })

  test('safeFormScore answers NULL for the bad rows instead of raising', async () => {
    // The expression on its own, with NO where clause, so its NULL arm is what is
    // under test rather than the filter that skips these rows.
    const got = await withStore(async (db) => {
      const out = await db<{ server_job_id: string; score: number | null }[]>`
        select server_job_id, ${db.unsafe(safeFormScore('summary_json'))} as score
        from analysis_history
        where auth0_id = ${ORG} and student_id = ${STUDENT}::uuid
        order by server_job_id asc
      `
      return out ?? []
    })
    const byJob = new Map(got.map((r) => [r.server_job_id, r.score]))
    expect(byJob.get(SCORED)).toBe(7.5)
    expect(byJob.get(NOT_A_NUMBER)).toBeNull()
    expect(byJob.get(OVERFLOWS)).toBeNull()
    expect(byJob.get(NO_SCORE_AT_ALL)).toBeNull()
  })

  test('the performance series returns the real score and skips the rest', async () => {
    const series = await getStudentPerformanceSeries(ORG, STUDENT)
    expect(series.map((p) => p.metric_value)).toEqual([7.5])
    expect(series.every((p) => p.source === 'analysis')).toBe(true)
  }, 60000)

  test('the student comparison is just as unaffected', async () => {
    const comparison = await compareStudents(ORG, [STUDENT, OTHER])
    expect(comparison).toHaveLength(2)
    expect(comparison[0]!.avg).toBe(7.5)
    expect(comparison[1]!.avg).toBeNull()
    expect(comparison[1]!.points).toEqual([])
  }, 60000)

  test('"analyses with a score" means a NUMBER, so the report stores no NaN', async () => {
    // `listRecentAnalysisScores` used to filter on `->>'form_score' is not null`,
    // which is "has the key": "N/A" passed, and `analysesBlock`'s Number() then
    // stored NaN. The block must contain the one scored analysis and nothing else.
    const recent = await listRecentAnalysisScores(ORG)
    expect(recent.map((r) => r.server_job_id)).toEqual([SCORED])

    const content = await buildReportContent(ORG, {})
    const analyses = (content as { analyses: Array<{ form_score: number | null }> }).analyses
    expect(analyses).toHaveLength(1)
    expect(analyses[0]!.form_score).toBe(7.5)
    expect(analyses.some((a) => Number.isNaN(a.form_score))).toBe(false)
  }, 60000)

  test('the list projection still reports every row, with NULL where unscorable', async () => {
    const listed = await getStudentAnalyses(ORG, STUDENT)
    expect(listed).toHaveLength(rows.length)
    const byJob = new Map(listed.map((r) => [r.server_job_id, r.summary_json]))
    expect(byJob.get(SCORED)).toEqual({ form_score: 7.5 })
    expect(byJob.get(NOT_A_NUMBER)).toBeNull()
    expect(byJob.get(OVERFLOWS)).toBeNull()
  }, 60000)
})

/** Run a statement against the live store the suite wired. */
async function withStore<T>(fn: (db: SQL) => Promise<T>): Promise<T> {
  const { withHistoryStoreOrThrow } = await import('../src/lib/historyStore')
  return withHistoryStoreOrThrow(fn)
}
