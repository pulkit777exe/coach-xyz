// ── Notifications (compat shim) ──────────────────────────────────────────────
// Split into ./notificationsStore (persistence) + ./notificationsEvents
// (pub/sub fan-out + queue hooks). Re-exported here so existing importers
// keep working; new code should import the seam directly.
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
  attachNotificationQueueEvents,
  createNotification,
  onNotification,
} from './notificationsEvents'
