// ── Org reports subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type { ReportRecord } from './types'

// ── Reports ──────────────────────────────────────────────────────────────────

export const orgReports = async (
  auth0Id: string,
  opts: { studentId?: string } = {},
): Promise<{ reports: ReportRecord[] }> => {
  const qs = opts.studentId ? `?studentId=${encodeURIComponent(opts.studentId)}` : ''
  return queryJson<{ reports: ReportRecord[] }>(orgUrl(auth0Id, `/reports${qs}`))
}

export const orgReport = async (auth0Id: string, id: string): Promise<{ report: ReportRecord }> => {
  return queryJson<{ report: ReportRecord }>(orgUrl(auth0Id, `/reports/${encodeURIComponent(id)}`))
}

export const orgCreateReport = async (
  auth0Id: string,
  input: {
    student_id?: string
    report_type: string
    period_start?: string
    period_end?: string
    title?: string
  },
): Promise<{ report: ReportRecord }> => {
  return mutateJson<{ report: ReportRecord }>(
    orgUrl(auth0Id, '/reports'),
    'POST',
    pickDefined(input),
  )
}

export const orgDeleteReport = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    orgUrl(auth0Id, `/reports/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgUpdateReport = async (
  auth0Id: string,
  id: string,
  input: {
    report_type?: string
    period_start?: string | null
    period_end?: string | null
    title?: string
  },
): Promise<{ report: ReportRecord }> => {
  return mutateJson<{ report: ReportRecord }>(
    orgUrl(auth0Id, `/reports/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}
