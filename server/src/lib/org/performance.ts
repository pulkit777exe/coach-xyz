// Performance metrics data layer — split from lib/orgData.ts.

import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from '../historyStore'
import { computeMetricTrends as computeTrends } from '../orgValidate'
import type { MetricTrend } from '../orgValidate'
import { getStudent } from './students'

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

export const listPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string; limit?: number } = {},
): Promise<PerformanceMetric[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<PerformanceMetric[]>`
        select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
               source_analysis_id, measured_at, created_at
        from performance_metrics
        where auth0_id = ${auth0Id} and student_id = ${studentId}
          and (${opts.metricKey ?? ''} = '' or metric_key = ${opts.metricKey ?? null})
          and (${opts.from ?? null}::timestamptz is null or measured_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or measured_at <= ${opts.to ?? null}::timestamptz)
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
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
        ${input.measured_at ?? null}::timestamptz
      )
      on conflict (auth0_id, student_id, metric_key, measured_at) do nothing
      returning id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at;
    `
    return rows?.[0] ?? null
  })
}

export const updatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<PerformanceMetric | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
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
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from performance_metrics where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

/**
 * Combined performance timeline for a student: manual metrics + form scores
 * extracted from completed AI analyses.
 */
export const getStudentPerformanceSeries = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<PerformanceSeriesPoint[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const analyses = await db<
        {
          requested_at: string
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
        order by requested_at asc;
      `
      const manual = await listPerformance(auth0Id, studentId, {
        metricKey: opts.metricKey || undefined,
        from: opts.from,
        to: opts.to,
      })

      const points: PerformanceSeriesPoint[] = [
        ...(analyses ?? []).map((a) => ({
          id: null as string | null,
          measured_at: a.requested_at,
          metric_key: 'form_score',
          metric_value: a.form_score as number,
          unit: '/10',
          source: 'analysis' as const,
          source_analysis_id: a.server_job_id,
        })),
        ...(manual ?? []).map((m) => ({
          id: m.id,
          measured_at: m.measured_at,
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
  opts: { metricKey?: string; from?: string; to?: string } = {},
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

  return withHistoryStore(async (_db) => {
    await ensureInitialized()

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
