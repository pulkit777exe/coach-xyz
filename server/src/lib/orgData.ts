// ── orgData barrel ─────────────────────────────────────────────────────────────
// Card 4 split: the vertical-slice subdomains live in orgRoster /
// orgAttendance / orgObjectives / orgReports (shared store: orgStore). This
// module re-exports the full assembled view so existing importers (scripts,
// tests) keep working; route/lib code imports the subdomain modules
// directly. All names and signatures are unchanged from the pre-split file.
export type {
  AttendanceStatus,
  EventStatus,
  EventType,
  ReportType,
  StudentStatus,
} from './orgEnums'
export { computeMetricTrends } from './orgValidate'
export type { MetricTrend, TrendPoint } from './orgValidate'
export * from './orgRoster'
export * from './orgAttendance'
export * from './orgObjectives'
export * from './orgReports'
