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
  /** ISO time of the last digest email actually sent; null = never sent. */
  lastDigestAt: string | null
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

export async function leaveOrganization(
  orgAuth0Id: string,
): Promise<{ left: boolean; teams: string[] }> {
  return apiFetch<{ left: boolean; teams: string[] }>(
    me(`/orgs/${encodeURIComponent(orgAuth0Id)}/leave`),
    { method: 'POST' },
  )
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

// ── Consent, portability & deletion requests ─────────────────────────────────
// Self-scoped like the rest of this module: the verified session IS the
// resource owner, so no call below ever takes an account id. Mirrors
// server/src/lib/{consents,dataExport,privacyRequests}.ts.

/** One boolean per processing purpose + the policy version answered under. */
export type PlayerConsent = {
  /** False when the account has no linked player: nothing can be recorded. */
  linked: boolean
  /** Present only when linked — the player row the consent belongs to. */
  studentId?: string
  policyVersion: string
  trainingData: boolean
  medicalData: boolean
  marketing: boolean
  updatedAt: string | null
}

export type ConsentPatch = {
  trainingData?: boolean
  medicalData?: boolean
  marketing?: boolean
}

export const CONSENT_PURPOSES = ['trainingData', 'medicalData', 'marketing'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const PRIVACY_REQUEST_TYPES = ['export', 'delete'] as const
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number]

export const PRIVACY_REQUEST_STATUSES = [
  'received',
  'in_progress',
  'completed',
  'declined',
] as const
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number]

export type PrivacyRequest = {
  id: string
  type: PrivacyRequestType
  /** 'received' = logged and awaiting review, NOT yet actioned. */
  status: PrivacyRequestStatus
  createdAt: string
  resolvedAt: string | null
}

/**
 * The whole-account JSON bundle (server `GET /api/me/export`, which also sets
 * Content-Disposition). `analyses` is the player-facing shape — wellness keys
 * are stripped server-side, exactly as the player hub sees them.
 */
export type AccountExport = {
  formatVersion: number
  exportedAt: string
  account: { auth0Id: string }
  user: UserRecord | null
  student: Student | null
  coachAuth0Id: string | null
  attendance: AttendanceWithStudent[]
  attendanceSummary: AttendanceSummary | null
  schedule: ScheduleEvent[]
  performance: PerformanceSeriesPoint[]
  analyses: DashboardPlayerAnalysis[]
  reports: Array<ReportRecord & { full_name: string | null }>
  objectives: MyObjectives['objectives']
  notifications: Array<{ id: string; type: string; title: string; read: boolean }>
  notificationPreferences: NotificationPrefs
  displaySettings: UserSettings
  consent: PlayerConsent
  privacyRequests: PrivacyRequest[]
}

export async function getMyConsent(): Promise<PlayerConsent> {
  return apiFetch<PlayerConsent>(me('/consent'))
}

export async function updateMyConsent(patch: ConsentPatch): Promise<PlayerConsent> {
  return apiFetch<PlayerConsent>(me('/consent'), {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

/** The immediate, self-service copy of everything the account holds. */
export async function getMyDataExport(): Promise<AccountExport> {
  return apiFetch<AccountExport>(me('/export'))
}

export async function listMyPrivacyRequests(): Promise<{ requests: PrivacyRequest[] }> {
  return apiFetch<{ requests: PrivacyRequest[] }>(me('/privacy-requests'))
}

/**
 * Record a portability/deletion request. Nothing is deleted by this call — a
 * delete request is reviewed by a human, so the UI must present it as a
 * request, never as a completed action.
 */
export async function createMyPrivacyRequest(
  type: PrivacyRequestType,
): Promise<{ request: PrivacyRequest }> {
  return apiFetch<{ request: PrivacyRequest }>(me('/privacy-requests'), {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}
