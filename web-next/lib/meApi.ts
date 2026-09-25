import { apiFetch, IDENTITY_BASE, type UserRecord } from './api'
import type { OrgMemberRole } from './members'
import type { ThemeChoice } from './preferences'
import type {
  AttendanceWithStudent,
  AttendanceSummary,
  PerformanceSeriesPoint,
  ReportRecord,
  ScheduleEvent,
  Student,
} from './org'

// ── Player Hub API ──────────────────────────────────────────────────────────
// Self-scoped ("/api/me/*") read-only endpoints for the player/student face.
// Identity is guaranteed by the browser session (client) or service headers
// (server) — never by a caller-supplied auth0Id.

export type MyOrg = {
  org_auth0_id: string
  // Membership role — the single vocabulary (ORG_MEMBER_ROLES), not a fifth
  // spelling of the same 8 literals.
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

export const NOTIFICATION_EVENTS = [
  'analysis_complete',
  'analysis_failed',
  'report_ready',
  'attendance',
  'ai_report',
  'membership',
] as const
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]
export type NotificationEvents = Record<NotificationEvent, boolean>

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  analysis_complete: 'Analysis complete',
  analysis_failed: 'Analysis failed',
  report_ready: 'Report ready',
  attendance: 'Attendance recorded',
  ai_report: 'AI report finished',
  membership: 'Membership changes',
}

export type NotificationCadence = 'instant' | 'daily' | 'weekly'

export type NotificationPrefs = {
  inApp: boolean
  cadence: NotificationCadence
  events: NotificationEvents
  updatedAt: string | null
}

export type NotificationPrefsPatch = {
  inApp?: boolean
  cadence?: NotificationCadence
  events?: Partial<NotificationEvents>
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

export type MyReport = {
  report: (ReportRecord & { full_name: string | null }) | null
  linked: boolean
}

const me = (path: string) => `${IDENTITY_BASE}/api/me${path}`

export async function getMyOrgs(): Promise<MyOrgs> {
  return apiFetch<MyOrgs>(me('/orgs'))
}

export async function getMyProfile(): Promise<MyProfile> {
  return apiFetch<MyProfile>(me('/profile'))
}

export async function updateMyProfile(input: {
  name?: string | null
  nickname?: string | null
  picture?: string | null
}): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(me('/profile'), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  return apiFetch<NotificationPrefs>(me('/notification-preferences'))
}

export async function updateNotificationPrefs(
  patch: NotificationPrefsPatch,
): Promise<NotificationPrefs> {
  return apiFetch<NotificationPrefs>(me('/notification-preferences'), {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

// ── Synced user settings (theme, motion, week start) ─────────────────────────
// Device-local first (instant, works signed-out), mirrored to the account so
// the same choices follow the user to another browser.
export type UserSettings = {
  theme: ThemeChoice
  reduceMotion: boolean
  weekStartsMonday: boolean
  updatedAt: string | null
}

export type UserSettingsPatch = Omit<UserSettings, 'updatedAt'>

export async function getUserSettings(): Promise<UserSettings> {
  return apiFetch<UserSettings>(me('/preferences'))
}

export async function updateUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
  return apiFetch<UserSettings>(me('/preferences'), {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function getMyAttendance(): Promise<MyAttendance> {
  return apiFetch<MyAttendance>(me('/attendance'))
}

export async function getMySchedule(): Promise<MySchedule> {
  return apiFetch<MySchedule>(me('/schedule'))
}

export async function getMyPerformance(): Promise<MyPerformance> {
  return apiFetch<MyPerformance>(me('/performance'))
}

export async function getMyAnalyses(): Promise<MyAnalyses> {
  return apiFetch<MyAnalyses>(me('/analyses'))
}

export async function getMyReports(): Promise<MyReports> {
  return apiFetch<MyReports>(me('/reports'))
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
  return apiFetch<MyObjectives>(me('/objectives'))
}

export async function acceptInvite(token: string): Promise<{ org_auth0_id: string; role: string }> {
  return apiFetch<{ org_auth0_id: string; role: string }>(me('/invites/accept'), {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function getMyReport(id: string): Promise<MyReport> {
  return apiFetch<MyReport>(me(`/reports/${encodeURIComponent(id)}`))
}
