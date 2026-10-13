// ── Org student subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import type { DashboardAnalysis } from '../library'
import { mutateJson, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type { PerformanceMetric, PerformanceSeriesPoint } from './types'

// ── Student detail ───────────────────────────────────────────────────────────

export const orgStudentPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<{ series: PerformanceSeriesPoint[] }> => {
  const params = new URLSearchParams()
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ series: PerformanceSeriesPoint[] }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/performance${qs ? `?${qs}` : ''}`),
  )
}

export const orgAddPerformanceMetric = async (
  auth0Id: string,
  studentId: string,
  input: { metric_key: string; metric_value: number; unit?: string | null; measured_at?: string },
): Promise<{ metric: PerformanceMetric }> => {
  return mutateJson<{ metric: PerformanceMetric }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/performance`),
    'POST',
    input,
  )
}

export const orgStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
): Promise<{ analyses: DashboardAnalysis[] }> => {
  return queryJson<{ analyses: DashboardAnalysis[] }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/analyses`),
  )
}
