// Performance metrics data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow } from '../historyStore'
import { computeMetricTrends as computeTrends } from '../orgValidate'
import type { MetricTrend } from '../orgValidate'
import { uuidArrayLiteral } from './scope'
import { getStudent } from './students'

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

export const listPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: PerformanceSeriesOptions & { limit?: number } = {},
): Promise<PerformanceMetric[]> => {
  return (
    (await withHistoryStoreOrThrow(async (db) => {
      const filter = scopeFilter(opts.studentIds)
      const rows = await db<PerformanceMetric[]>`
        select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
               source_analysis_id, measured_at, created_at
        from performance_metrics
        where auth0_id = ${auth0Id} and student_id = ${studentId}
          and (${opts.metricKey ?? ''} = '' or metric_key = ${opts.metricKey ?? null})
          and (${opts.from ?? null}::timestamptz is null or measured_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or measured_at <= ${opts.to ?? null}::timestamptz)
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
      const analyses = await db<
        {
          requested_at: string | Date
          form_score: number | null
          server_job_id: string
        }[]
      >`
        select
          requested_at,
          (summary_json->>'form_score')::float8 as form_score,
          server_job_id
        from analysis_history
        where auth0_id = ${auth0Id}
          and student_id = ${studentId}::uuid
          and complete = true
          and summary_json is not null
          and (summary_json->>'form_score') is not null
          and (${opts.from ?? null}::timestamptz is null or requested_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or requested_at <= ${opts.to ?? null}::timestamptz)
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

/**
 * Compare multiple students on a single metric key.
 * Returns per-student latest, avg, and full points array.
 */
export const compareStudents = async (
  auth0Id: string,
  studentIds: string[],
  metricKey = 'form_score',
): Promise<ComparisonStudent[]> => {
  if (studentIds.length === 0) return []

  return withHistoryStoreOrThrow(async (_db) => {
    const result: ComparisonStudent[] = []

    for (const sid of studentIds) {
      const series = await getStudentPerformanceSeries(auth0Id, sid, {})
      const filtered = series.filter((s) => s.metric_key === metricKey)
      const values = filtered.map((s) => s.metric_value)

      const student = await getStudent(auth0Id, sid)
      result.push({
        student_id: sid,
        full_name: student?.full_name ?? 'Unknown',
        latest: values.length > 0 ? values[values.length - 1] : null,
        avg:
          values.length > 0
            ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100
            : null,
        points: filtered.map((s) => ({
          measured_at: s.measured_at,
          metric_value: s.metric_value,
        })),
      })
    }

    return result
  })
}
