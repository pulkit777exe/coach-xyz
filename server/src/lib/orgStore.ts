// ── Shared org store helper ──────────────────────────────────────────────────
// Single home for the history-store handle used by the four org subdomain
// modules (orgRoster / orgAttendance / orgObjectives / orgReports), so the
// store is imported once here instead of four copies reaching into
// historyStore directly.
export { withHistoryStore, withHistoryStoreOrThrow, ensureInitialized } from './historyStore'
