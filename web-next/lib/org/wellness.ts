// ── Org wellness subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'

// ── Wellness check-ins (health data, §5 — medical permission to read) ──────

export type WellnessCheckin = {
  id: string
  org_auth0_id: string
  student_id: string
  sleep_hours: number | null
  fatigue: number | null
  pain: string | null
  availability: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export const orgWellness = async (
  auth0Id: string,
  studentId: string,
): Promise<{ checkins: WellnessCheckin[] }> =>
  queryJson<{ checkins: WellnessCheckin[] }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/wellness`),
  )

export const orgCreateWellness = async (
  auth0Id: string,
  studentId: string,
  input: {
    sleep_hours?: number | null
    fatigue?: number | null
    pain?: string | null
    availability?: string | null
    note?: string | null
  },
): Promise<{ checkin: WellnessCheckin }> =>
  mutateJson<{ checkin: WellnessCheckin }>(
    orgUrl(auth0Id, `/students/${encodeURIComponent(studentId)}/wellness`),
    'POST',
    pickDefined(input),
  )
