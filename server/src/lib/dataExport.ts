// ── Account data export (portability) ────────────────────────────────────────
// One self-contained JSON bundle of everything the CALLER's account holds, for
// a GDPR/CCPA-style "give me my data" request. Two rules govern this file:
//
//  1. Self-scoped by construction. The only identity input is the verified
//     account sub; the player link is resolved from it here, so there is no
//     parameter through which a caller could aim the bundle at another account.
//     Every org-scoped read is keyed by the link's OWNING COACH id AND the
//     linked student id. An unlinked account gets empty coaching data (not the
//     coach's).
//  2. No new SQL. Every read is an existing self-scoped data function, so the
//     export cannot drift from what the player hub itself shows.

import type { DashboardAnalysis } from './analyses'
import { consentForStudent, unlinkedConsent, type PlayerConsent } from './consents'
import {
  attendanceSummary,
  getLinkedPlayer,
  getStudentAnalyses,
  getStudentPerformanceSeries,
  listAttendance,
  listObjectives,
  listReports,
  listSchedule,
} from './orgData'
import type {
  AttendanceSummary,
  AttendanceWithStudent,
  LinkedPlayer,
  PerformanceSeriesPoint,
  ReportRecord,
  ScheduleEvent,
  Student,
  TrainingObjective,
} from './orgData'
import { listNotifications, type NotificationRow } from './notifications'
import { notificationPrefs, type NotificationPreferences } from './notificationPrefs'
import { redactWellness } from './permissions'
import { listPrivacyRequests, type PrivacyRequest } from './privacyRequests'
import { userSettings, type UserSettings } from './userSettings'
import { getUserByAuth0Id, type UserRecord } from './users'

/** Bumped when the bundle's shape changes, so a consumer can tell. */
export const EXPORT_FORMAT_VERSION = 1

/** Bounded like every other paginated read: a bundle is a copy, not a dump. */
export const EXPORT_ANALYSIS_LIMIT = 200
export const EXPORT_SCHEDULE_LIMIT = 500
export const EXPORT_NOTIFICATION_LIMIT = 200
export const EXPORT_PRIVACY_REQUEST_LIMIT = 50

/**
 * An analysis as the player sees it: the wellness keys are stripped from every
 * summary, exactly as GET /api/me/analyses does (§5), so `summary_json` widens
 * from the coach's typed record to whatever survived redaction.
 */
export type ExportAnalysis = Omit<DashboardAnalysis, 'summary_json'> & {
  summary_json: unknown
}

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
  analyses: ExportAnalysis[]
  reports: Array<ReportRecord & { full_name: string | null }>
  objectives: TrainingObjective[]
  notifications: NotificationRow[]
  notificationPreferences: NotificationPreferences
  displaySettings: UserSettings
  consent: PlayerConsent
  privacyRequests: PrivacyRequest[]
}

/** The verified account plus the player row it is linked to. */
export type ExportScope = {
  accountAuth0Id: string
  student: Student | null
  coachAuth0Id: string | null
}

/** Every read the bundle needs, injectable so tests can pin the scoping. */
export type AccountExportSources = {
  getUser: typeof getUserByAuth0Id
  getLinkedPlayer: typeof getLinkedPlayer
  listAttendance: typeof listAttendance
  attendanceSummary: typeof attendanceSummary
  listSchedule: typeof listSchedule
  getStudentPerformanceSeries: typeof getStudentPerformanceSeries
  getStudentAnalyses: typeof getStudentAnalyses
  listReports: typeof listReports
  listObjectives: typeof listObjectives
  listNotifications: typeof listNotifications
  notificationPrefs: (auth0Id: string) => Promise<NotificationPreferences>
  userSettings: typeof userSettings
  listPrivacyRequests: typeof listPrivacyRequests
  getConsent: (studentId: string) => Promise<PlayerConsent>
}

export const DEFAULT_EXPORT_SOURCES: AccountExportSources = {
  getUser: getUserByAuth0Id,
  getLinkedPlayer,
  listAttendance,
  attendanceSummary,
  listSchedule,
  getStudentPerformanceSeries,
  getStudentAnalyses,
  listReports,
  listObjectives,
  listNotifications,
  notificationPrefs,
  userSettings,
  listPrivacyRequests,
  getConsent: consentForStudent,
}

/**
 * Resolve the account's player link. The coach id comes from the link (never
 * from the caller), so every org-scoped read below inherits the right owner.
 */
export const exportScopeFor = async (
  accountAuth0Id: string,
  sources: AccountExportSources = DEFAULT_EXPORT_SOURCES,
): Promise<ExportScope> => {
  const linked: LinkedPlayer | null = await sources.getLinkedPlayer(accountAuth0Id)
  return {
    accountAuth0Id,
    student: linked?.student ?? null,
    coachAuth0Id: linked?.coachAuth0Id ?? null,
  }
}

/**
 * Build the caller's bundle. The account's own records (profile, notifications,
 * preferences, consent, requests) always come back; the coaching records are
 * present only for a linked player, keyed by the link's coach + student id.
 */
export const buildAccountExport = async (
  accountAuth0Id: string,
  overrides: Partial<AccountExportSources> = {},
): Promise<AccountExport> => {
  const sources: AccountExportSources = { ...DEFAULT_EXPORT_SOURCES, ...overrides }
  const {
    accountAuth0Id: account,
    student,
    coachAuth0Id,
  } = await exportScopeFor(accountAuth0Id, sources)
  const link = student && coachAuth0Id ? { student, coachAuth0Id } : null

  // Two parallel groups: the account's own records, and (only for a linked
  // player) the coaching records under the link's own ids.
  const [own, linked] = await Promise.all([
    Promise.all([
      sources.getUser(account),
      sources.listNotifications(account, { limit: EXPORT_NOTIFICATION_LIMIT }),
      sources.notificationPrefs(account),
      sources.userSettings(account),
      sources.listPrivacyRequests(account, { limit: EXPORT_PRIVACY_REQUEST_LIMIT }),
      link ? sources.getConsent(link.student.id) : null,
    ]),
    link
      ? Promise.all([
          sources.listAttendance(link.coachAuth0Id, { studentId: link.student.id }),
          sources.attendanceSummary(link.coachAuth0Id, { studentId: link.student.id }),
          // The whole fixture history, capped: unlike the screens, a portability bundle
          // is meant to be all of it, so this passes a limit and no window.
          sources.listSchedule(link.coachAuth0Id, { limit: EXPORT_SCHEDULE_LIMIT }),
          sources.getStudentPerformanceSeries(link.coachAuth0Id, link.student.id),
          // `fullSummary` is the point of the bundle: a portability export is the
          // one read that must carry the whole summary, not the list projection
          // `getStudentAnalyses` defaults to (which is what every screen needs).
          // Wellness is still stripped below — this is player scope.
          sources.getStudentAnalyses(link.coachAuth0Id, link.student.id, EXPORT_ANALYSIS_LIMIT, {
            fullSummary: true,
          }),
          sources.listReports(link.coachAuth0Id, { studentId: link.student.id }),
          sources.listObjectives(link.coachAuth0Id, { studentId: link.student.id }),
        ])
      : null,
  ])

  const [user, notifications, notificationPreferences, displaySettings, privacyRequests, consent] =
    own

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    account: { auth0Id: account },
    user,
    student: link?.student ?? null,
    coachAuth0Id: link?.coachAuth0Id ?? null,
    attendance: linked?.[0] ?? [],
    attendanceSummary: linked?.[1] ?? null,
    schedule: linked?.[2] ?? [],
    performance: linked?.[3] ?? [],
    // Player scope never carries wellness signals (same redaction as
    // GET /api/me/analyses) — the export is that same player scope.
    analyses: (linked?.[4] ?? []).map((analysis) => ({
      ...analysis,
      summary_json: redactWellness(analysis.summary_json),
    })),
    reports: linked?.[5] ?? [],
    objectives: linked?.[6] ?? [],
    notifications,
    notificationPreferences,
    displaySettings,
    consent: consent ?? unlinkedConsent(),
    privacyRequests,
  }
}

/** The download filename the export route sets (and the UI mirrors). */
export const exportFilename = (now: Date = new Date()): string =>
  `coachxyz-export-${now.toISOString().slice(0, 10)}.json`
