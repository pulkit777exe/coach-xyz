// ── Org data export (reviewed, not automatic) ─────────────────────────────────
// One JSON bundle of an org's coaching records for owner/admin review
// (portability requests, audits, hand-off). Every section is bounded; the
// caller decides which sections leave the building (the route answers CSV per
// section too). Wellness rides only when the caller holds `medical.read` —
// admins do not, owners do — enforced here, not just hidden in the UI.

import { rowsToCsv } from './csv'
import {
  attendanceSummary,
  listAttendance,
  listObjectives,
  listReports,
  listStudents,
  listTrainingPlans,
  type AttendanceSummary,
  type AttendanceWithStudent,
  type ReportRecord,
  type Student,
  type TrainingObjective,
  type TrainingPlan,
} from './orgData'
import {
  groupWellnessByStudent,
  listWellnessForStudents,
  type WellnessCheckin,
} from './org/wellness'

/** Per-section caps: a bundle is a copy, not a dump. */
export const ORG_EXPORT_LIMITS = {
  students: 2000,
  attendance: 5000,
  reports: 1000,
  objectives: 1000,
  plans: 1000,
  wellnessPerStudent: 50,
} as const

export const ORG_EXPORT_FORMAT_VERSION = 1

export type OrgExportSection = 'roster' | 'attendance' | 'reports' | 'objectives' | 'plans'

export const ORG_EXPORT_SECTIONS: readonly OrgExportSection[] = [
  'roster',
  'attendance',
  'reports',
  'objectives',
  'plans',
]

export type OrgExport = {
  formatVersion: number
  exportedAt: string
  orgAuth0Id: string
  wellnessIncluded: boolean
  roster: Student[]
  attendance: AttendanceWithStudent[]
  attendanceSummary: AttendanceSummary | null
  reports: Array<ReportRecord & { full_name: string | null }>
  objectives: TrainingObjective[]
  plans: TrainingPlan[]
  /** Present only for callers holding `medical.read`; otherwise absent. */
  wellness?: Array<WellnessCheckin & { student_id: string }>
}

/** Every read the bundle needs, injectable so tests pin caps and gating. */
export type OrgExportSources = {
  listStudents: typeof listStudents
  listAttendance: typeof listAttendance
  attendanceSummary: typeof attendanceSummary
  listReports: typeof listReports
  listObjectives: typeof listObjectives
  listTrainingPlans: typeof listTrainingPlans
  listWellnessForStudents: typeof listWellnessForStudents
}

export const DEFAULT_ORG_EXPORT_SOURCES: OrgExportSources = {
  listStudents,
  listAttendance,
  attendanceSummary,
  listReports,
  listObjectives,
  listTrainingPlans,
  listWellnessForStudents,
}

export const buildOrgExport = async (
  orgAuth0Id: string,
  opts: { includeWellness: boolean } = { includeWellness: false },
  sources: OrgExportSources = DEFAULT_ORG_EXPORT_SOURCES,
): Promise<OrgExport> => {
  const [roster, attendance, summary, reports, objectives, plans] = await Promise.all([
    sources.listStudents(orgAuth0Id, { includeArchived: true, limit: ORG_EXPORT_LIMITS.students }),
    sources.listAttendance(orgAuth0Id, { limit: ORG_EXPORT_LIMITS.attendance }),
    sources.attendanceSummary(orgAuth0Id, {}),
    sources.listReports(orgAuth0Id, { limit: ORG_EXPORT_LIMITS.reports }),
    sources.listObjectives(orgAuth0Id, { limit: ORG_EXPORT_LIMITS.objectives }),
    sources.listTrainingPlans(orgAuth0Id, { limit: ORG_EXPORT_LIMITS.plans }),
  ])

  // Player scope never carries wellness signals; analysis summaries are out
  // of scope for this bundle (roster, attendance, reports, objectives, plans).

  let wellness: OrgExport['wellness']
  if (opts.includeWellness) {
    // ONE read for the whole roster, not one per student. `roster` is capped at
    // ORG_EXPORT_LIMITS.students (2000), so this was up to 2000 round trips —
    // `Promise.all`'d, so not a stall, but a 2000-deep queue against a `max: 5`
    // pool, competing with live traffic for the same connections. The rows come
    // back grouped by student_id; the group-by puts them back in ROSTER order
    // (each student's own rows still newest first), which is the order the
    // per-student fan-out produced, so the bundle is byte-identical.
    const rosterIds = roster.map((student) => student.id)
    const rows = await sources.listWellnessForStudents(
      orgAuth0Id,
      rosterIds,
      ORG_EXPORT_LIMITS.wellnessPerStudent,
    )
    const byStudent = groupWellnessByStudent(rosterIds, rows)
    wellness = roster.flatMap((student) => byStudent.get(student.id) ?? [])
  }

  return {
    formatVersion: ORG_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    orgAuth0Id,
    wellnessIncluded: opts.includeWellness,
    roster,
    attendance,
    attendanceSummary: summary,
    reports,
    objectives,
    plans,
    ...(wellness === undefined ? {} : { wellness }),
  }
}

const ROSTER_COLUMNS = [
  'id',
  'full_name',
  'email',
  'sport',
  'position',
  'team_id',
  'status',
  'joined_on',
] as const

const ATTENDANCE_COLUMNS = ['id', 'student_id', 'session_date', 'status', 'note'] as const

/** One section as CSV text (pure; BOM-free — the route adds it). */
export const orgExportSectionToCsv = (
  section: OrgExportSection,
  bundle: OrgExport,
): string => {
  switch (section) {
    case 'roster':
      return rowsToCsv(
        ROSTER_COLUMNS,
        bundle.roster.map((s) => [
          s.id,
          s.full_name,
          s.email,
          s.sport,
          s.position,
          s.team_id,
          s.status,
          s.joined_on,
        ]),
      )
    case 'attendance':
      return rowsToCsv(
        ATTENDANCE_COLUMNS,
        bundle.attendance.map((a) => [a.id, a.student_id, a.session_date, a.status, a.note]),
      )
    case 'reports':
      return rowsToCsv(
        ['id', 'title', 'report_type', 'student_id', 'created_at'],
        bundle.reports.map((r) => [r.id, r.title, r.report_type, r.student_id, r.created_at]),
      )
    case 'objectives':
      return rowsToCsv(
        ['id', 'title', 'status', 'student_id', 'team_id'],
        bundle.objectives.map((o) => [o.id, o.title, o.status, o.student_id, o.team_id]),
      )
    case 'plans':
      return rowsToCsv(
        ['id', 'title', 'status', 'student_id', 'team_id'],
        bundle.plans.map((p) => [p.id, p.title, p.status, p.student_id, p.team_id]),
      )
  }
}
