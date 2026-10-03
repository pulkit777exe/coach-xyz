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
  attendanceSummary: (async () => null) as unknown as OrgExportSources['attendanceSummary'],
  listReports: (async () => []) as OrgExportSources['listReports'],
  listObjectives: (async () => []) as OrgExportSources['listObjectives'],
  listTrainingPlans: (async () => []) as OrgExportSources['listTrainingPlans'],
  // Must answer rows shaped like the real batched read — `student_id` included —
  // or the group-by has nothing to key on and the test passes vacuously.
  listWellnessForStudents: (async () => [
    { id: 'w1', student_id: 's1' },
    { id: 'w2', student_id: 's1' },
    { id: 'w3', student_id: 's2' },
  ]) as unknown as OrgExportSources['listWellnessForStudents'],
  ...overrides,
})

describe('buildOrgExport', () => {
  test('wellness is absent unless explicitly included', async () => {
    const without = await buildOrgExport('auth0|org', { includeWellness: false }, sources())
    expect(without.wellnessIncluded).toBe(false)
    expect('wellness' in without).toBe(false)
    const withWellness = await buildOrgExport('auth0|org', { includeWellness: true }, sources())
    expect(withWellness.wellnessIncluded).toBe(true)
    // Both check-ins of BOTH students, not one row per student.
    expect(withWellness.wellness?.length).toBe(3)
    // Each check-in carries its student for review.
    expect(withWellness.wellness?.[0]).toMatchObject({ student_id: 's1' })
  })

  test('wellness is ONE read for the whole roster, not one per student', async () => {
    // The defect: `roster.map(student => listWellness(...))` is up to
    // ORG_EXPORT_LIMITS.students (2000) round trips. Count the reads instead of
    // trusting the shape, and pin the cap that reaches the data layer.
    const calls: Array<{ ids: number; limit: number }> = []
    const roster = Array.from({ length: 50 }, (_, i) => student(`s${i + 1}`))
    const recording = sources({
      listStudents: (async () => roster) as OrgExportSources['listStudents'],
      listWellnessForStudents: (async (_org: string, ids: string[], limit: number) => {
        calls.push({ ids: ids.length, limit })
        return ids.map((id) => ({ id: `w-${id}`, student_id: id }))
      }) as unknown as OrgExportSources['listWellnessForStudents'],
    })

    const bundle = await buildOrgExport('auth0|org', { includeWellness: true }, recording)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ ids: 50, limit: ORG_EXPORT_LIMITS.wellnessPerStudent })
    expect(bundle.wellness).toHaveLength(50)
  })

  test('wellness comes back in roster order regardless of the ids order', async () => {
    // The batched read keys by student_id, so a row order that follows the ids
    // would reorder the bundle versus the old per-student fan-out. Roster order
    // is what the export documented, and the old implementation's, because
    // `Promise.all` preserved the roster's order and `flat()` kept it.
    const recording = sources({
      listStudents: (async () => [
        student('s3'),
        student('s1'),
        student('s2'),
      ]) as OrgExportSources['listStudents'],
      // Deliberately the OPPOSITE of roster order — a source that sorted by id.
      listWellnessForStudents: (async (_org: string, ids: string[]) =>
        [...ids].sort().map((id) => ({
          id: `w-${id}`,
          student_id: id,
        }))) as unknown as OrgExportSources['listWellnessForStudents'],
    })

    const bundle = await buildOrgExport('auth0|org', { includeWellness: true }, recording)
    expect(bundle.wellness?.map((w) => w.student_id)).toEqual(['s3', 's1', 's2'])
  })

  test('a student with no check-ins contributes nothing and drops no one else', async () => {
    // A Map keyed by student_id with no entry for the empty student must not
    // shift the others, and `flatMap` over the roster must still visit every
    // student — so the empty case is a real assertion, not a null check.
    const recording = sources({
      listStudents: (async () => [
        student('s1'),
        student('s2'),
        student('s3'),
      ]) as OrgExportSources['listStudents'],
      listWellnessForStudents: (async () => [
        { id: 'w1', student_id: 's1' },
        { id: 'w3', student_id: 's3' },
      ]) as unknown as OrgExportSources['listWellnessForStudents'],
    })

    const bundle = await buildOrgExport('auth0|org', { includeWellness: true }, recording)
    expect(bundle.wellness?.map((w) => w.student_id)).toEqual(['s1', 's3'])
  })

  test('an empty roster still calls the wellness source once, with nothing', async () => {
    // The seam that makes this cheap is a short-circuit on an empty id list, so
    // the call is made and the source sees an empty roster rather than the
    // bundle skipping the source entirely.
    const calls: number[] = []
    const recording = sources({
      listStudents: (async () => []) as OrgExportSources['listStudents'],
      listWellnessForStudents: (async (_org: string, ids: string[]) => {
        calls.push(ids.length)
        return []
      }) as unknown as OrgExportSources['listWellnessForStudents'],
    })
    const bundle = await buildOrgExport('auth0|org', { includeWellness: true }, recording)
    expect(calls).toEqual([0])
    expect(bundle.wellness).toEqual([])
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
