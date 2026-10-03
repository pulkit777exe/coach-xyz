// Performance metrics data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { computeMetricTrends as computeTrends, isDate } from '../orgValidate'
import type { MetricTrend } from '../orgValidate'
import { uuidArrayLiteral } from './scope'
import { getStudentsByIds } from './students'
import { hasNumericFormScore, safeFormScore } from '../formScoreSql'

/**
 * Bind pair for the student-scope filter (the list `visibleStudentIds` returns
 * in `lib/org/scope.ts`): `undefined`/`null` means org-wide and adds no
 * predicate, a list means exactly those students, and `[]` means the caller
 * sees nobody.
 *
 * The binding is the one proven in `org/students.ts`: an empty list binds NULL
 * (Bun sends `[]` as '', which is not a valid uuid[] literal) so
 * `not ${scoped} or student_id = any(NULL::uuid[])` matches no rows — the honest
 * answer for a coach who manages no team — while a non-empty list goes through
 * `uuidArrayLiteral`, because a raw JS array reaches Postgres as comma-joined
 * text and the `::uuid[]` cast then fails.
 */
const scopeFilter = (ids: string[] | null | undefined) => ({
  scoped: ids !== undefined && ids !== null,
  param: ids !== undefined && ids !== null && ids.length > 0 ? uuidArrayLiteral(ids) : null,
})

export type PerformanceMetric = {
  id: string
  auth0_id: string
  student_id: string
  metric_key: string
  metric_value: number
  unit: string | null
  source_analysis_id: string | null
  measured_at: string
  created_at: string
}

export type PerformanceSeriesPoint = {
  id: string | null
  measured_at: string
  metric_key: string
  metric_value: number
  unit: string | null
  source: 'analysis' | 'manual'
  source_analysis_id: string | null
}

// ── Performance ──────────────────────────────────────────────────────────────

/** Series/list options; `studentIds` narrows every query to visible students. */
export type PerformanceSeriesOptions = {
  metricKey?: string
  from?: string
  to?: string
  /** Visible student ids from `lib/org/scope.ts`; null/undefined = org-wide. */
  studentIds?: string[] | null
}

/**
 * A period's upper bound, and whether it names a whole day.
 *
 * `to` arrives in two shapes. The report path passes `period_end`, always a bare
 * `YYYY-MM-DD` (`isDate`-validated in routes/org/reports.ts and
 * routes/aiReports.ts), meaning "through the end of that day". The series route
 * passes a query param, which may be a bare date or a full instant.
 *
 * Both were compared as `col <= to::timestamptz`, and for a bare date that cast is
 * *midnight* — so a report for 2026-09-01..2026-09-30 silently dropped every
 * metric and analysis recorded on the 30th, while the attendance half of the very
 * same report (`session_date <= to::date`) kept the day. Nothing errored; the
 * numbers were just quietly short.
 *
 * So the bound is now **exclusive**, and `toIsDay` shifts it by one day only when
 * the caller named a day. The arithmetic stays in Postgres so no timezone is
 * involved, and the boolean gate is the same "one query shape for both cases"
 * pattern the scope filters use.
 */
const toBound = (to: string | null | undefined): { to: string | null; toIsDay: boolean } => ({
  to: to ?? null,
  toIsDay: typeof to === 'string' && isDate(to),
})

export const listPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: PerformanceSeriesOptions & { limit?: number } = {},
): Promise<PerformanceMetric[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const filter = scopeFilter(opts.studentIds)
      const upper = toBound(opts.to)
      const rows = await db<PerformanceMetric[]>`
        select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
               source_analysis_id, measured_at, created_at
        from performance_metrics
        where auth0_id = ${auth0Id} and student_id = ${studentId}
          and (${opts.metricKey ?? ''} = '' or metric_key = ${opts.metricKey ?? null})
          and (${opts.from ?? null}::timestamptz is null or measured_at >= ${opts.from ?? null}::timestamptz)
          and (${upper.to}::timestamptz is null or measured_at < ${upper.to}::timestamptz + (case when ${upper.toIsDay} then interval '1 day' else interval '0' end))
          and (not ${filter.scoped} or student_id = any(${filter.param}::uuid[]))
        order by measured_at asc
        limit ${opts.limit ?? 500};
      `
      return rows ?? []
    })) ?? []
  )
}

export type PerformanceInput = {
  student_id: string
  metric_key: string
  metric_value: number
  unit?: string | null
  source_analysis_id?: string | null
  measured_at?: string | null
}

export const createPerformanceMetric = async (
  auth0Id: string,
  input: PerformanceInput,
): Promise<PerformanceMetric | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<PerformanceMetric[]>`
      insert into performance_metrics (
        auth0_id, student_id, metric_key, metric_value, unit, source_analysis_id, measured_at
      ) values (
        ${auth0Id},
        ${input.student_id}::uuid,
        ${input.metric_key},
        ${input.metric_value}::float8,
        ${input.unit ?? null},
        ${input.source_analysis_id ?? null},
        -- An explicit NULL does not fall back to the column default
        -- (measured_at is NOT NULL DEFAULT now()), it raises 23502.
        -- measured_at is optional in PerformanceInput and the web's date
        -- field is optional, so logging without a date has to mean "now".
        coalesce(${input.measured_at ?? null}::timestamptz, now())
      )
      on conflict (auth0_id, student_id, metric_key, measured_at) do nothing
      returning id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at;
    `
    return rows?.[0] ?? null
  })
}

/**
 * Resolve a metric row by id so a write guard can ask which student the metric
 * belongs to before mutating anything: `canSeeStudent` needs a student id, and
 * the write routes are keyed by metric id.
 */
export const getPerformanceMetric = async (
  auth0Id: string,
  id: string,
): Promise<PerformanceMetric | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<PerformanceMetric[]>`
      select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at
      from performance_metrics
      where auth0_id = ${auth0Id} and id = ${id}::uuid
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const updatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<PerformanceMetric | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    const rows = await db<PerformanceMetric[]>`
      update performance_metrics set
        metric_value = ${input.metric_value}::float8,
        unit = ${input.unit ?? null}
      where auth0_id = ${auth0Id} and id = ${id}::uuid and source_analysis_id is null
      returning id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at;
    `
    return rows?.[0] ?? null
  })
}

export const deletePerformanceMetric = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<{ id: string }[]>`
      delete from performance_metrics where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

/**
 * Combined performance timeline for a student: manual metrics + form scores
 * extracted from completed AI analyses. `opts.studentIds` narrows both halves of
 * the timeline, so a team-scoped caller never sees another team's series.
 */
export const getStudentPerformanceSeries = async (
  auth0Id: string,
  studentId: string,
  opts: PerformanceSeriesOptions = {},
): Promise<PerformanceSeriesPoint[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const filter = scopeFilter(opts.studentIds)
      const upper = toBound(opts.to)
      // The score arrives through safeFormScore/hasNumericFormScore from
      // lib/formScoreSql.ts — the one SSOT for "a form_score Postgres can cast". A
      // bare (summary_json->>'form_score')::float8 raises 22P02 on ONE row whose
      // score is "N/A", and it 500s the whole series for every caller. Both
      // fragments go through db.unsafe() because a tagged template binds an
      // interpolated value as a PARAMETER, not as SQL text.
      const analyses = await db<
        {
          requested_at: string | Date
          form_score: number | null
          server_job_id: string
        }[]
      >`
        select
          requested_at,
          ${db.unsafe(safeFormScore('summary_json'))} as form_score,
          server_job_id
        from analysis_history
        where auth0_id = ${auth0Id}
          and student_id = ${studentId}::uuid
          and complete = true
          and summary_json is not null
          and ${db.unsafe(hasNumericFormScore('summary_json'))}
          and (${opts.from ?? null}::timestamptz is null or requested_at >= ${opts.from ?? null}::timestamptz)
          and (${upper.to}::timestamptz is null or requested_at < ${upper.to}::timestamptz + (case when ${upper.toIsDay} then interval '1 day' else interval '0' end))
          and (not ${filter.scoped} or student_id = any(${filter.param}::uuid[]))
        order by requested_at asc;
      `
      const manual = await listPerformance(auth0Id, studentId, {
        metricKey: opts.metricKey || undefined,
        from: opts.from,
        to: opts.to,
        studentIds: opts.studentIds,
      })

      // Bun decodes a timestamptz column to a Date, not to the string these
      // types declare. Everything downstream treats measured_at as a string —
      // including the sort below, and orgValidate.computeMetricTrends, which
      // runs its own localeCompare sort over the same points — so normalize
      // where the value enters the domain object. With a single point
      // Array#sort never calls its comparator, which is why a student with one
      // metric looked fine while a student with two threw
      // "a.measured_at.localeCompare is not a function", taking the performance
      // series and every report built from it with it.
      const iso = (value: string | Date): string =>
        value instanceof Date ? value.toISOString() : new Date(value).toISOString()

      const points: PerformanceSeriesPoint[] = [
        ...(analyses ?? []).map((a) => ({
          id: null as string | null,
          measured_at: iso(a.requested_at),
          metric_key: 'form_score',
          metric_value: a.form_score as number,
          unit: '/10',
          source: 'analysis' as const,
          source_analysis_id: a.server_job_id,
        })),
        ...(manual ?? []).map((m) => ({
          id: m.id,
          measured_at: iso(m.measured_at),
          metric_key: m.metric_key,
          metric_value: m.metric_value,
          unit: m.unit,
          source: 'manual' as const,
          source_analysis_id: m.source_analysis_id,
        })),
      ]

      points.sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      return points
    })) ?? []
  )
}

// ── Trends ─────────────────────────────────────────────────────────────────

/**
 * Group the student's performance series into per-metric trends with slope
 * info (latest, avg, change). Pure computation lives in orgValidate.computeMetricTrends.
 */
export const getStudentTrends = async (
  auth0Id: string,
  studentId: string,
  opts: PerformanceSeriesOptions = {},
): Promise<MetricTrend[]> => {
  const series = await getStudentPerformanceSeries(auth0Id, studentId, opts)
  return computeTrends(series)
}

// ── Comparison ─────────────────────────────────────────────────────────────

export type ComparisonStudent = {
  student_id: string
  full_name: string
  latest: number | null
  avg: number | null
  points: Array<{ measured_at: string; metric_value: number }>
}

/** Per-student cap on comparison points — the `limit 500` the per-student
 *  `listPerformance` call used to apply, now a windowed rank so batching the
 *  students into one query cannot truncate any single one of them. */
const COMPARISON_POINT_CAP = 500

/**
 * Compare multiple students on a single metric key.
 * Returns per-student latest, avg, and full points array.
 *
 * This was a 3N-query N+1 that ran entirely serially: per student it called
 * `getStudentPerformanceSeries` (two statements — `analysis_history` for the
 * form scores, `performance_metrics` for the manual ones) and then
 * `getStudent`, i.e. exactly 3 round trips per id, so the route's 10-id cap
 * meant 30 sequential queries. It is now three statements for the whole batch,
 * issued concurrently, and each carries the id list as `= any(…::uuid[])`.
 *
 * Two deliberate changes inside those statements:
 *
 *  - `metric_key` is pushed down instead of filtered in JS. The per-student loop
 *    read every metric for every id and then kept one key; the caller asked for
 *    a single metric, so reading the others was pure volume. Same result set.
 *  - The per-student `limit 500` becomes `row_number() over (partition by
 *    student_id …) <= 500`, so the cap stays PER STUDENT. A single `limit 500`
 *    across the batch would silently truncate a busy org's later ids, which the
 *    per-student version could not do.
 *
 * `getStudentsByIds` is the existing batched name lookup (it already binds
 * through `uuidArrayLiteral`), so there is no second spelling of
 * `id = any(…::uuid[])` in this file.
 */
export const compareStudents = async (
  auth0Id: string,
  studentIds: string[],
  metricKey = 'form_score',
): Promise<ComparisonStudent[]> => {
  if (studentIds.length === 0) return []

  const requested = studentIds.filter((id) => typeof id === 'string' && id.length > 0)
  if (requested.length === 0) return []

  const { analyses, manual, students } = await withHistoryStoreOrThrow(async (db) => {
    const literal = uuidArrayLiteral(requested)
    // Precomputed before any await, and exactly one target per id: a duplicate
    // id in the query string is one id as far as the SQL is concerned, so no row
    // is fetched twice and no `on conflict do update` cardinality trap applies.
    // Only the completion is parallelised — nothing here depends on another's
    // result, so emission order carries no meaning and nothing downstream has to
    // sort to be correct.
    const [analyses, manual, students] = await Promise.all([
      // Same guarded cast as the single-student series above.
      db<{ student_id: string; requested_at: string | Date; form_score: number | null }[]>`
        select
          student_id,
          requested_at,
          ${db.unsafe(safeFormScore('summary_json'))} as form_score
        from analysis_history
        where auth0_id = ${auth0Id}
          and student_id = any(${literal}::uuid[])
          and complete = true
          and summary_json is not null
          and ${db.unsafe(hasNumericFormScore('summary_json'))}
        order by requested_at asc;
      `,
      db<PerformanceMetric[]>`
        select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
               source_analysis_id, measured_at, created_at
        from (
          select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
                 source_analysis_id, measured_at, created_at,
                 row_number() over (partition by student_id order by measured_at asc) as rn
          from performance_metrics
          where auth0_id = ${auth0Id}
            and student_id = any(${literal}::uuid[])
            and metric_key = ${metricKey}
        ) ranked
        where rn <= ${COMPARISON_POINT_CAP}
        order by measured_at asc;
      `,
      // The route already dropped invisible ids, so this is the roster read for
      // names only — same single statement `getStudentsByIds` would have run.
      getStudentsByIds(auth0Id, requested),
    ])
    return { analyses: analyses ?? [], manual: manual ?? [], students: students ?? [] }
  })

  // Bun decodes a timestamptz to a Date, not the string these shapes declare.
  // Normalize where the value enters the domain object — see the longer note in
  // getStudentPerformanceSeries, whose one-row blind spot this is the same one.
  const iso = (value: string | Date): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString()

  const formScores = new Map<string, PerformanceSeriesPoint[]>()
  for (const a of analyses) {
    const points = formScores.get(a.student_id) ?? []
    points.push({
      id: null,
      measured_at: iso(a.requested_at),
      // The analysis half of the timeline is always the `form_score` metric; the
      // per-student loop filtered it out unless that was the requested key.
      metric_key: 'form_score',
      metric_value: a.form_score as number,
      unit: '/10',
      source: 'analysis',
      source_analysis_id: null,
    })
    formScores.set(a.student_id, points)
  }

  const manualByStudent = new Map<string, PerformanceSeriesPoint[]>()
  for (const m of manual) {
    const points = manualByStudent.get(m.student_id) ?? []
    points.push({
      id: m.id,
      measured_at: iso(m.measured_at),
      metric_key: m.metric_key,
      metric_value: m.metric_value,
      unit: m.unit,
      source: 'manual',
      source_analysis_id: m.source_analysis_id,
    })
    manualByStudent.set(m.student_id, points)
  }

  const nameById = new Map(students.map((s) => [s.id, s.full_name]))
  const wanted = metricKey === 'form_score'

  // One entry per REQUESTED id, in the requested order — including ids with no
  // data, which the per-student loop still answered with a named, empty row (and
  // which the route relies on to tell a scoreless player from a missing one).
  return requested.map((sid) => {
    const points = [
      ...(wanted ? (formScores.get(sid) ?? []) : []),
      ...(manualByStudent.get(sid) ?? []),
    ]
    points.sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    const values = points.map((p) => p.metric_value)
    return {
      student_id: sid,
      full_name: nameById.get(sid) ?? 'Unknown',
      latest: values.length > 0 ? values[values.length - 1] : null,
      avg:
        values.length > 0
          ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100
          : null,
      points: points.map((p) => ({
        measured_at: p.measured_at,
        metric_value: p.metric_value,
      })),
    }
  })
}
