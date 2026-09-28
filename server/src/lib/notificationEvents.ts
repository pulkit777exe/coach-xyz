// ── Notification emission seam ───────────────────────────────────────────────
// Producers call a named helper instead of hand-rolling
// `createNotification({ type: 'some_string' })`, so the event name, the payload
// and the destination a recipient needs all live in one place. The names
// themselves come from the dependency-free vocabulary module.

import { createNotification, type CreateNotificationInput } from './notificationCreate'
import { NOTIFICATION_EVENT, type NotificationEventName } from './notificationEventNames'

export { analysisResultHref, NOTIFICATION_EVENT } from './notificationEventNames'

/** Injectable transport — tests pass a recorder instead of touching the DB. */
type Emit = (input: CreateNotificationInput) => Promise<unknown>

type EmitArgs = {
  auth0Id: string
  title: string
  body?: string | null
  data?: Record<string, unknown>
  dedupeKey?: string | null
}

const emit = async (
  event: NotificationEventName,
  args: EmitArgs,
  notify: Emit = createNotification,
): Promise<unknown> => {
  const { auth0Id, ...rest } = args
  return notify({ auth0Id, type: event, ...rest })
}

export const notifyAnalysisResult = (
  args: EmitArgs & { event: 'analysisComplete' | 'analysisFailed' },
  notify?: Emit,
) => emit(NOTIFICATION_EVENT[args.event], args, notify)

export const notifyReportReady = (
  args: EmitArgs & { reportId: string; href: string },
  notify?: Emit,
) =>
  emit(
    NOTIFICATION_EVENT.reportReady,
    { ...args, data: { ...args.data, report_id: args.reportId, href: args.href } },
    notify,
  )

export const notifyAttendanceRecorded = (args: EmitArgs, notify?: Emit) =>
  emit(NOTIFICATION_EVENT.attendanceRecorded, args, notify)

export const notifyAiReportFinished = (args: EmitArgs, notify?: Emit) =>
  emit(NOTIFICATION_EVENT.aiReportFinished, args, notify)

export const notifyMembershipChanged = (args: EmitArgs, notify?: Emit) =>
  emit(NOTIFICATION_EVENT.membershipChanged, args, notify)
