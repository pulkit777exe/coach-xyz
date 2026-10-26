// ── Org students subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type {
  ComparisonStudent,
  MetricTrend,
  Student,
  StudentFormValues,
  StudentImportResult,
  StudentImportRow,
} from './types'

// ── Students ─────────────────────────────────────────────────────────────────

export const orgStudents = async (
  auth0Id: string,
  opts: { search?: string; sport?: string; status?: string; includeArchived?: boolean } = {},
): Promise<{ students: Student[] }> => {
  const params = new URLSearchParams()
  if (opts.search) params.set('search', opts.search)
  if (opts.sport) params.set('sport', opts.sport)
  if (opts.status) params.set('status', opts.status)
  if (opts.includeArchived) params.set('include_archived', 'true')
  const qs = params.toString()
  return queryJson<{ students: Student[] }>(orgUrl(auth0Id, `/students${qs ? `?${qs}` : ''}`))
}

export const orgStudentsSports = async (auth0Id: string): Promise<{ sports: string[] }> => {
  return queryJson<{ sports: string[] }>(orgUrl(auth0Id, '/students/sports'))
}

export const orgStudent = async (auth0Id: string, id: string): Promise<{ student: Student }> => {
  return queryJson<{ student: Student }>(orgUrl(auth0Id, `/students/${encodeURIComponent(id)}`))
}

export const orgCreateStudent = async (
  auth0Id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return mutateJson<{ student: Student }>(orgUrl(auth0Id, '/students'), 'POST', pickDefined(input))
}

export const orgUpdateStudent = async (
  auth0Id: string,
  id: string,
  input: Partial<StudentFormValues>,
): Promise<{ student: Student }> => {
  return mutateJson<{ student: Student }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}

export const orgDeleteStudent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(id)}`),
    'DELETE',
  )
}

export const orgImportStudents = async (
  auth0Id: string,
  rows: StudentImportRow[],
): Promise<StudentImportResult> => {
  return mutateJson<StudentImportResult>(orgUrl(auth0Id, '/students/import'), 'POST', { rows })
}

export const orgStudentTrends = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<{ trends: MetricTrend[] }> => {
  const params = new URLSearchParams()
  if (opts.metricKey) params.set('metricKey', opts.metricKey)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ trends: MetricTrend[] }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/trends${qs ? `?${qs}` : ''}`),
  )
}

export const orgCompareStudents = async (
  auth0Id: string,
  ids: string[],
  metricKey?: string,
): Promise<{ comparison: ComparisonStudent[] }> => {
  const qsParts = [`ids=${ids.map(encodeURIComponent).join(',')}`]
  if (metricKey) qsParts.push(`metricKey=${encodeURIComponent(metricKey)}`)
  return queryJson<{ comparison: ComparisonStudent[] }>(
    orgUrl(auth0Id, `/students/comparison?${qsParts.join('&')}`),
  )
}
