// ── Org performance subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type { PerformanceMetric } from './types'

// ── Performance metrics ──────────────────────────────────────────────────────

export const orgPerformanceMetrics = async (
  auth0Id: string,
  opts: { studentId: string; metricKey?: string; from?: string; to?: string },
): Promise<{ metrics: PerformanceMetric[] }> => {
  const params = new URLSearchParams({ studentId: opts.studentId })
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  return queryJson<{ metrics: PerformanceMetric[] }>(
    orgUrl(auth0Id, `/performance?${params.toString()}`),
  )
}

export const orgDeletePerformanceMetric = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    orgUrl(auth0Id, `/performance/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgUpdatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<{ metric: PerformanceMetric }> => {
  return mutateJson<{ metric: PerformanceMetric }>(
    orgUrl(auth0Id, `/performance/${encodeURIComponent(id)}`),
    'PUT',
    input,
  )
}
