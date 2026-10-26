import type { UserRecord } from './user'
import type { OrgMemberRole } from './members'
import { mutateJson, queryJson } from './data/client'
import { meUrl } from './data/transport'
import type { AttendanceWithStudent, AttendanceSummary, PerformanceSeriesPoint, ReportRecord, ScheduleEvent, Student } from './org/types'

// ── Player Hub API ──────────────────────────────────────────────────────────
// Self-scoped ("/api/me/*") read-only endpoints for the player/student face.
// Identity is guaranteed by the browser session (client) or service headers
// (server) — never by a caller-supplied auth0Id.

export type MyOrg = {
  org_auth0_id: string
  role: OrgMemberRole
  display_name: string | null
}

export type MyOrgs = {
  orgs: MyOrg[]
}

export type MyProfile = {
  user: UserRecord | null
  student: Student | null
  coach_auth0_id: string | null
}

export type MyAttendance = {
  records: AttendanceWithStudent[]
  summary: AttendanceSummary | null
  linked: boolean
}

export type MySchedule = {
  events: ScheduleEvent[]
  linked: boolean
}

export type MyPerformance = {
  points: PerformanceSeriesPoint[]
  linked: boolean
}

export type MyAnalyses = {
  analyses: DashboardPlayerAnalysis[]
  linked: boolean
}

export type DashboardPlayerAnalysis = {
  server_job_id: string
  engine_job_id: string
  model: string
  complete: boolean
  video_ready: boolean
  summary_json: unknown
  display_name: string | null
  requested_at: string
  completed_at: string | null
}

export type MyReports = {
  reports: Array<ReportRecord & { full_name: string | null }>
  linked: boolean
}

const me = (path: string) => meUrl(path)

export async function getMyOrgs(): Promise<MyOrgs> {
  return queryJson<MyOrgs>(me('/orgs'))
}

export async function getMyProfile(): Promise<MyProfile> {
  return queryJson<MyProfile>(me('/profile'))
}

export async function updateMyProfile(input: {
  name?: string | null
  nickname?: string | null
  picture?: string | null
}): Promise<{ user: UserRecord }> {
  return mutateJson<{ user: UserRecord }>(me('/profile'), 'PUT', input)
}

export async function getMyAttendance(): Promise<MyAttendance> {
  return queryJson<MyAttendance>(me('/attendance'))
}

export async function getMySchedule(): Promise<MySchedule> {
  return queryJson<MySchedule>(me('/schedule'))
}

export async function getMyPerformance(): Promise<MyPerformance> {
  return queryJson<MyPerformance>(me('/performance'))
}

export async function getMyAnalyses(): Promise<MyAnalyses> {
  return queryJson<MyAnalyses>(me('/analyses'))
}

export async function getMyReports(): Promise<MyReports> {
  return queryJson<MyReports>(me('/reports'))
}

export type MyObjectives = {
  objectives: Array<{
    id: string
    title: string
    description: string | null
    status: string
    due_on: string | null
    finding_id: string | null
    created_at: string
  }>
  linked: boolean
}

export async function getMyObjectives(): Promise<MyObjectives> {
  return queryJson<MyObjectives>(me('/objectives'))
}

export async function acceptInvite(token: string): Promise<{ org_auth0_id: string; role: string }> {
  return mutateJson<{ org_auth0_id: string; role: string }>(me('/invites/accept'), 'POST', {
    token,
  })
}

export async function getMyReport(
  id: string,
): Promise<{ report: (ReportRecord & { full_name: string | null }) | null; linked: boolean }> {
  return queryJson<{
    report: (ReportRecord & { full_name: string | null }) | null
    linked: boolean
  }>(me(`/reports/${encodeURIComponent(id)}`))
}

export async function getNotificationPrefs(): Promise<{ inApp: boolean }> {
  return { inApp: true }
}
