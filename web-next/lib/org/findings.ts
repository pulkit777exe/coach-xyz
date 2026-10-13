// ── Org findings subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { queryJson } from '../data/client'
import { authUserUrl } from '../data/transport'

export type StoredFinding = {
  id: string
  server_job_id: string
  category: string | null
  start_ms: number | null
  end_ms: number | null
  confidence: number | null
  confidence_band: string | null
  severity: string | null
  observation: string | null
  feedback: string | null
  form_score: number | null
  evidence_frames: unknown
  measured_at_timestamp: number | null
  model_versions: unknown
  review_state: string
  created_at: string
}

export const orgStudentFindings = async (
  auth0Id: string,
  studentId: string,
  limit = 20,
): Promise<{ findings: StoredFinding[] }> => {
  const params = new URLSearchParams({ student_id: studentId, limit: String(limit) })
  return queryJson<{ findings: StoredFinding[] }>(
    authUserUrl(auth0Id, `/findings?${params.toString()}`),
  )
}

/** Export URL for a student's findings CSV (server-serialized, BOM-prefixed). */
export const studentFindingsExportUrl = (auth0Id: string, studentId: string, limit = 200) => {
  const params = new URLSearchParams({ student_id: studentId, limit: String(limit) })
  return authUserUrl(auth0Id, `/findings/export?${params.toString()}`)
}

/**
 * Downloads a student's findings as CSV through the identity proxy (session
 * headers are injected there, so no manual auth wiring). Client-only: creates
 * a blob download named findings-<studentId>.csv.
 */
export const downloadStudentFindingsCsv = async (
  auth0Id: string,
  studentId: string,
): Promise<void> => {
  const res = await fetch(studentFindingsExportUrl(auth0Id, studentId), {
    headers: { 'x-request-id': crypto.randomUUID() },
  })
  if (!res.ok) {
    let message = `Export failed (${res.status})`
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      // non-JSON error — keep the status message
    }
    throw new Error(message)
  }
  const text = await res.text()
  const url = window.URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `findings-${studentId}.csv`
  a.click()
  window.URL.revokeObjectURL(url)
}
