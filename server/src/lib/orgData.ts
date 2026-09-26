// ── Org data layer ───────────────────────────────────────────────────────────
// Thin barrel over src/lib/org/* (one module per subdomain, split from this
// file). This preserves the single public surface that routes and lib code
// import from — no consumer changes. Re-exports are explicit named exports.

export type {
  AttendanceStatus,
  EventStatus,
  EventType,
  ReportType,
  StudentStatus,
} from './orgEnums'
export { computeMetricTrends } from './orgValidate'
export type { MetricTrend, TrendPoint } from './orgValidate'

export type { Student, LinkedPlayer, StudentInput, ImportResult } from './org/students'
export {
  listStudents,
  getStudent,
  getLinkedPlayer,
  createStudent,
  updateStudent,
  deleteStudent,
  listStudentSports,
  importStudents,
} from './org/students'

export type { TrainingObjective, ObjectiveInput } from './org/objectives'
export {
  listObjectives,
  getObjective,
  createObjective,
  setObjectiveStatus,
  deleteObjective,
} from './org/objectives'

export type { Season, Match } from './org/compete'
export {
  listSeasons,
  createSeason,
  deleteSeason,
  listMatches,
  getMatch,
  createMatch,
  deleteMatch,
} from './org/compete'

export type { TrainingPlan } from './org/plans'
export {
  listTrainingPlans,
  getTrainingPlan,
  createTrainingPlan,
  setTrainingPlanStatus,
  deleteTrainingPlan,
} from './org/plans'

export type { WellnessCheckin } from './org/wellness'
export { listWellness, createWellnessCheckin } from './org/wellness'

export type { AttendanceRecord, AttendanceWithStudent, AttendanceSummary } from './org/attendance'
export {
  listAttendance,
  upsertAttendance,
  setAttendanceBatch,
  deleteAttendance,
  attendanceSummary,
} from './org/attendance'

export type { ScheduleEvent, ScheduleInput } from './org/schedule'
export {
  listSchedule,
  getScheduleEvent,
  createScheduleEvent,
  updateScheduleEvent,
  deleteScheduleEvent,
} from './org/schedule'

export type { ReportRecord, ReportInput } from './org/reports'
export {
  getStudentAnalyses,
  listReports,
  getReport,
  createReportRecord,
  deleteReport,
  listRecentAnalysisScores,
  buildReportContent,
  updateReportRecord,
} from './org/reports'

export type {
  PerformanceMetric,
  PerformanceInput,
  PerformanceSeriesPoint,
  ComparisonStudent,
} from './org/performance'
export {
  listPerformance,
  getPerformanceMetric,
  createPerformanceMetric,
  updatePerformanceMetric,
  deletePerformanceMetric,
  getStudentPerformanceSeries,
  getStudentTrends,
  compareStudents,
} from './org/performance'

export type { OrgOverview, SearchItem, OrgSearchResult } from './org/overview'
export { getOrgOverview, searchOrg } from './org/overview'

export type { OrgSettings, OrgSettingsPatch } from './org/settings'
export {
  emptyOrgSettings,
  isIanaTimezone,
  ORG_NAME_MAX_LENGTH,
  orgSettings,
  updateOrgSettings,
  validateOrgSettingsPatch,
} from './org/settings'
