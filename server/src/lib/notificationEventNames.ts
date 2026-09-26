// ── Notification event vocabulary ────────────────────────────────────────────
// The names themselves, with no imports on purpose.
//
// Event names are matched against a user's stored preferences by string, and an
// unknown name is treated as ENABLED (fail-open). A typo therefore does not
// fail — it silently ignores the mute the user set. Keeping the vocabulary in a
// dependency-free leaf means every other module can import it without creating
// a cycle, and `satisfies NotificationEvent` turns a typo into a type error.

import type { NotificationEvent } from './notificationPrefs'

/** Wire names, keyed by meaning. */
export const NOTIFICATION_EVENT = {
  analysisComplete: 'analysis_complete',
  analysisFailed: 'analysis_failed',
  reportReady: 'report_ready',
  attendanceRecorded: 'attendance',
  aiReportFinished: 'ai_report',
  membershipChanged: 'membership',
} as const satisfies Record<string, NotificationEvent>

export type NotificationEventName = (typeof NOTIFICATION_EVENT)[keyof typeof NOTIFICATION_EVENT]

/**
 * Where a recipient lands for an analysis event. The owning coach gets the
 * dashboard detail; a player who merely requested it has no detail route, so
 * their hub is the landing spot.
 */
export const analysisResultHref = (
  ownerAuth0Id: string,
  recipientAuth0Id: string,
  jobId: string,
): string => (recipientAuth0Id === ownerAuth0Id ? `/dashboard/analysis/${jobId}` : '/player')
