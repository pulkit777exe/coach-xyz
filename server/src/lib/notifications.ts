// ── Notifications (compat shim) ──────────────────────────────────────────────
// Split into ./notificationsStore (persistence) + ./notificationsEvents
// (pub/sub fan-out + direct worker notification calls). Re-exported here so
// existing importers keep working; new code should import the seam directly.
export {
  createNotificationRow,
  getAnalysisOwnerRow,
  listNotifications,
  markAllRead,
  markNotificationRead,
  unreadCount,
  type AnalysisOwner,
  type CreateNotificationInput,
  type NotificationRow,
} from './notificationsStore'
export {
  createNotification,
  notifyAnalysisOutcome,
  onNotification,
  type AnalysisOutcome,
} from './notificationsEvents'
