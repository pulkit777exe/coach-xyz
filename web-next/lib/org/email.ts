// ── Org email subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import type { DashboardAnalysis } from '../library'
import { mutateJson } from '../data/client'
import { emailUrl, orgUrl } from '../data/transport'

// ── Email (Resend) ───────────────────────────────────────────────────────────

export type EmailSendOutcome = {
  to: string
  ok: boolean
}

export const orgSendInvites = async (
  auth0Id: string,
  input: { emails: string[]; student_ids?: string[] },
): Promise<{ sent: EmailSendOutcome[]; total: number; failed: number }> => {
  return mutateJson<{ sent: EmailSendOutcome[]; total: number; failed: number }>(
    emailUrl(auth0Id, '/invite'),
    'POST',
    input,
  )
}

export const orgEmailReport = async (
  auth0Id: string,
  input: { report_id: string; to?: string },
): Promise<{ sent: { id: string | null; to: string; subject: string } }> => {
  return mutateJson<{ sent: { id: string | null; to: string; subject: string } }>(
    emailUrl(auth0Id, '/report'),
    'POST',
    input,
  )
}

export const orgEmailAttendance = async (
  auth0Id: string,
  input: { student_id?: string; from?: string; to?: string; recipient?: string },
): Promise<{ sent: unknown; records: number }> => {
  return mutateJson<{ sent: unknown; records: number }>(
    emailUrl(auth0Id, '/attendance'),
    'POST',
    input,
  )
}

export const linkAnalysisToStudent = async (
  auth0Id: string,
  jobId: string,
  studentId: string | null,
): Promise<{ analysis: DashboardAnalysis }> => {
  return mutateJson<{ analysis: DashboardAnalysis }>(
    orgUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/student`),
    'PUT',
    { student_id: studentId },
  )
}
