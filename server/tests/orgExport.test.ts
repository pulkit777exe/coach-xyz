import { describe, expect, test } from 'bun:test'

import {
  buildOrgExport,
  ORG_EXPORT_FORMAT_VERSION,
  ORG_EXPORT_LIMITS,
  orgExportSectionToCsv,
  type OrgExportSources,
} from '../src/lib/orgExport'

// ── Org export: bounded sections, gated wellness, safe CSV ──────────────────
// Pure unit tests with injected sources: no store, no mocks, no processes.

const student = (id: string) => ({
  id,
  auth0_id: 'auth0|org',
  full_name: `=Attacker ${id}`,
  email: null,
  phone: null,
  sport: null,
  position: null,
  jersey_number: null,
  date_of_birth: null,
  gender: null,
  guardian_name: null,
  guardian_phone: null,
  notes: null,
  status: 'active' as const,
  joined_on: null,
  account_auth0_id: null,
  team_id: null,
  created_at: '',
  updated_at: '',
})

const sources = (overrides: Partial<OrgExportSources> = {}): OrgExportSources => ({
  listStudents: (async () => [student('s1'), student('s2')]) as OrgExportSources['listStudents'],
  listAttendance: (async () => []) as OrgExportSources['listAttendance'],
  attendanceSummary: (async () => null) as OrgExportSources['attendanceSummary'],
  listReports: (async () => []) as OrgExportSources['listReports'],
  listObjectives: (async () => []) as OrgExportSources['listObjectives'],
  listTrainingPlans: (async () => []) as OrgExportSources['listTrainingPlans'],
  listWellness: (async () => [{ id: 'w1' }]) as OrgExportSources['listWellness'],
  ...overrides,
})

describe('buildOrgExport', () => {
  test('wellness is absent unless explicitly included', async () => {
    const without = await buildOrgExport('auth0|org', { includeWellness: false }, sources())
    expect(without.wellnessIncluded).toBe(false)
    expect('wellness' in without).toBe(false)
    const withWellness = await buildOrgExport('auth0|org', { includeWellness: true }, sources())
    expect(withWellness.wellnessIncluded).toBe(true)
    expect(withWellness.wellness?.length).toBe(2)
    // Each check-in carries its student for review.
    expect(withWellness.wellness?.[0]).toMatchObject({ student_id: 's1' })
  })

  test('every section is capped', async () => {
    const seen: Record<string, unknown> = {}
    const recording: OrgExportSources = sources({
      listStudents: (async (_org: string, opts?: { limit?: number }) => {
        seen.students = opts?.limit
        return []
      }) as OrgExportSources['listStudents'],
      listAttendance: (async (_org: string, opts?: { limit?: number }) => {
        seen.attendance = opts?.limit
        return []
      }) as OrgExportSources['listAttendance'],
      listReports: (async (_org: string, opts?: { limit?: number }) => {
        seen.reports = opts?.limit
        return []
      }) as OrgExportSources['listReports'],
      listObjectives: (async (_org: string, opts?: { limit?: number }) => {
        seen.objectives = opts?.limit
        return []
      }) as OrgExportSources['listObjectives'],
      listTrainingPlans: (async (_org: string, opts?: { limit?: number }) => {
        seen.plans = opts?.limit
        return []
      }) as OrgExportSources['listTrainingPlans'],
    })
    await buildOrgExport('auth0|org', { includeWellness: false }, recording)
    expect(seen).toEqual({
      students: ORG_EXPORT_LIMITS.students,
      attendance: ORG_EXPORT_LIMITS.attendance,
      reports: ORG_EXPORT_LIMITS.reports,
      objectives: ORG_EXPORT_LIMITS.objectives,
      plans: ORG_EXPORT_LIMITS.plans,
    })
  })

  test('the bundle is versioned and org-keyed', async () => {
    const bundle = await buildOrgExport('auth0|org', { includeWellness: false }, sources())
    expect(bundle.formatVersion).toBe(ORG_EXPORT_FORMAT_VERSION)
    expect(bundle.orgAuth0Id).toBe('auth0|org')
    expect(typeof bundle.exportedAt).toBe('string')
  })
})

describe('orgExportSectionToCsv', () => {
  test('formula-injecting names are defused', async () => {
    const bundle = await buildOrgExport('auth0|org', { includeWellness: false }, sources())
    const csv = orgExportSectionToCsv('roster', bundle)
    expect(csv.split('\n')[0]).toBe('id,full_name,email,sport,position,team_id,status,joined_on')
    // The `=Attacker` name gains a leading quote against spreadsheet formulas.
    expect(csv).toContain("'=Attacker s1")
  })
})
