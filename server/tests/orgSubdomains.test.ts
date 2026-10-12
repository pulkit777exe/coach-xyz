import { describe, expect, test } from 'bun:test'
import * as roster from '../src/lib/orgRoster'
import * as attendance from '../src/lib/orgAttendance'
import * as objectives from '../src/lib/orgObjectives'
import * as reports from '../src/lib/orgReports'
import * as store from '../src/lib/orgStore'
import * as barrel from '../src/lib/orgData'

// Card 4 split: orgData.ts divided into vertical-slice subdomains sharing one
// store helper. These tests stay DB-free — they assert module shape (every
// pre-split export present with identical identity through the barrel) and
// exercise the pure report-label assembly. No live DB is touched.

const ROSTER_FNS = [
  'listStudents',
  'getStudent',
  'getLinkedPlayer',
  'createStudent',
  'updateStudent',
  'deleteStudent',
  'listStudentSports',
  'listSeasons',
  'createSeason',
  'deleteSeason',
  'listMatches',
  'createMatch',
  'deleteMatch',
  'importStudents',
] as const

const ATTENDANCE_FNS = [
  'listAttendance',
  'upsertAttendance',
  'setAttendanceBatch',
  'deleteAttendance',
  'attendanceSummary',
  'listSchedule',
  'createScheduleEvent',
  'updateScheduleEvent',
  'deleteScheduleEvent',
] as const

const OBJECTIVES_FNS = [
  'listObjectives',
  'createObjective',
  'setObjectiveStatus',
  'deleteObjective',
  'listTrainingPlans',
  'createTrainingPlan',
  'setTrainingPlanStatus',
  'deleteTrainingPlan',
  'listWellness',
  'createWellnessCheckin',
] as const

const REPORTS_FNS = [
  'getStudentAnalyses',
  'listReports',
  'getReport',
  'createReportRecord',
  'deleteReport',
  'listRecentAnalysisScores',
  'buildReportContent',
  'buildPeriodLabel',
  'updateReportRecord',
  'listPerformance',
  'createPerformanceMetric',
  'updatePerformanceMetric',
  'deletePerformanceMetric',
  'getStudentPerformanceSeries',
  'getStudentTrends',
  'compareStudents',
  'getOrgOverview',
  'searchOrg',
] as const

describe('org subdomain module shape (pure move, no behavior change)', () => {
  test.each([...ROSTER_FNS])('orgRoster exports %s', (name) => {
    expect(typeof (roster as Record<string, unknown>)[name]).toBe('function')
  })

  test.each([...ATTENDANCE_FNS])('orgAttendance exports %s', (name) => {
    expect(typeof (attendance as Record<string, unknown>)[name]).toBe('function')
  })

  test.each([...OBJECTIVES_FNS])('orgObjectives exports %s', (name) => {
    expect(typeof (objectives as Record<string, unknown>)[name]).toBe('function')
  })

  test.each([...REPORTS_FNS])('orgReports exports %s', (name) => {
    expect(typeof (reports as Record<string, unknown>)[name]).toBe('function')
  })

  test('orgStore exposes the single shared store helper', () => {
    expect(typeof store.withHistoryStore).toBe('function')
    expect(typeof store.ensureInitialized).toBe('function')
  })
})

describe('orgData barrel (assembled view over the four slices)', () => {
  const all = [...ROSTER_FNS, ...ATTENDANCE_FNS, ...OBJECTIVES_FNS, ...REPORTS_FNS]

  test('barrel re-exports all 50 pre-split functions plus the report label helper', () => {
    for (const name of all) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('function')
    }
    expect(typeof barrel.computeMetricTrends).toBe('function')
  })

  test('barrel re-exports are identical references (no logic duplication)', () => {
    const mods = { roster, attendance, objectives, reports } as Record<
      string,
      Record<string, unknown>
    >
    const home: Record<string, string> = {}
    for (const name of ROSTER_FNS) home[name] = 'roster'
    for (const name of ATTENDANCE_FNS) home[name] = 'attendance'
    for (const name of OBJECTIVES_FNS) home[name] = 'objectives'
    for (const name of REPORTS_FNS) home[name] = 'reports'
    for (const name of all) {
      expect((barrel as Record<string, unknown>)[name]).toBe(mods[home[name]][name])
    }
  })
})

describe('buildPeriodLabel (pure report string assembly)', () => {
  test('labels a monthly report from its anchor month', () => {
    expect(reports.buildPeriodLabel({ reportType: 'monthly', from: '2026-08-01' })).toBe(
      'Month of August 2026',
    )
  })

  test('labels a bounded range', () => {
    expect(reports.buildPeriodLabel({ from: '2026-08-01', to: '2026-08-31' })).toBe(
      'from Aug 1, 2026 to Aug 31, 2026',
    )
  })

  test('labels open-ended ranges', () => {
    expect(reports.buildPeriodLabel({ from: '2026-08-01' })).toBe('since Aug 1, 2026')
    expect(reports.buildPeriodLabel({ to: '2026-08-31' })).toBe('through Aug 31, 2026')
  })

  test('falls back to All time without bounds', () => {
    expect(reports.buildPeriodLabel({})).toBe('All time')
  })
})
