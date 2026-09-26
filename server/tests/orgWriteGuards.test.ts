import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org write permission guards ──────────────────────────────────────────────
// Report, roster and performance writes used to ride the broad app-level org
// floor (membership), so a `medical` member could create/update/delete reports
// and a `medical` / `analyst` / `assistant_coach` member could create, edit,
// import or delete roster rows and write performance values — all of which the
// documented matrix denies them. Every handler now asks
// `resolveCaller(auth0Id, request).can(<permission>)` before any write.
//
// The probe (orgWriteGuardsProbe.ts) runs in a fresh Bun process per route case
// so its `mock.module` store/identity stubs cannot leak into the rest of the
// suite's shared module cache. It keeps the real `resolveCaller` and the real
// `permissions.ts` matrix, so an "allowed" case proves the route's own check
// agreed with the role → capability table instead of a hard-coded stub.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'orgWriteGuardsProbe.ts')

type WriteKey =
  | 'createReportRecord'
  | 'updateReportRecord'
  | 'deleteReport'
  | 'createStudent'
  | 'updateStudent'
  | 'deleteStudent'
  | 'importStudents'
  | 'createPerformanceMetric'
  | 'updatePerformanceMetric'
  | 'deletePerformanceMetric'

type ProbeResult = {
  role: OrgMemberRole | null
  status: number
  body: unknown
  writes: Record<WriteKey, number>
}

/** Drive one route case once per role, in a single isolated process. */
const runProbe = (probeCase: string, roles: readonly (OrgMemberRole | null)[]): ProbeResult[] => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ORG_WRITE_GUARD_CASE = probeCase
  env.ORG_WRITE_GUARD_ROLES = roles.map((role) => role ?? '__non_member__').join(',')

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  const results = JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult[]
  expect(results.length).toBe(roles.length)
  return results
}

const forbidden = (message: string) => ({
  code: 'FORBIDDEN',
  message,
  layer: 'server',
  retryable: false,
})

const REPORT_CREATE_MESSAGE = (action: 'Creating' | 'Updating' | 'Deleting') =>
  `${action} reports requires the report.create permission`

const PLAYER_MANAGE_MESSAGE = (
  action:
    | 'Creating students'
    | 'Updating students'
    | 'Deleting students'
    | 'Importing students'
    | 'Recording performance metrics',
) => `${action} requires the player.manage permission`

/** report.create: everyone who authors reports — only `medical`/`player` cannot. */
const REPORT_CREATE_ROLES: readonly OrgMemberRole[] = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
  'analyst',
]
const REPORT_CREATE_DENIED: readonly (OrgMemberRole | null)[] = ['medical', 'player', null]

/** player.manage: roster ownership is head-coach work. */
const PLAYER_MANAGE_ROLES: readonly OrgMemberRole[] = ['owner', 'admin', 'head_coach', 'coach']
const PLAYER_MANAGE_DENIED: readonly (OrgMemberRole | null)[] = [
  'assistant_coach',
  'analyst',
  'medical',
  'player',
  null,
]

/** The store spy: a denied request must leave every mutating counter at zero. */
const NO_WRITES: Record<WriteKey, number> = {
  createReportRecord: 0,
  updateReportRecord: 0,
  deleteReport: 0,
  createStudent: 0,
  updateStudent: 0,
  deleteStudent: 0,
  importStudents: 0,
  createPerformanceMetric: 0,
  updatePerformanceMetric: 0,
  deletePerformanceMetric: 0,
}

const label = (role: OrgMemberRole | null) => role ?? 'non-member'

/** Every role reached the handler and the one expected write landed. */
const expectAllowed = (
  results: ProbeResult[],
  status: number,
  writeKey: WriteKey,
  roles: readonly OrgMemberRole[],
) => {
  for (const result of results) {
    expect(result.status, `role: ${label(result.role)}`).toBe(status)
    expect(result.writes[writeKey], `role: ${label(result.role)}`).toBe(1)
  }
  expect(results.map((r) => r.role)).toEqual([...roles])
}

/** Every role was rejected with the named 403 and wrote nothing at all. */
const expectDenied = (
  results: ProbeResult[],
  message: string,
  roles: readonly (OrgMemberRole | null)[],
) => {
  for (const result of results) {
    expect(result.status, `role: ${label(result.role)}`).toBe(403)
    expect(result.body, `role: ${label(result.role)}`).toEqual(forbidden(message))
    expect(result.writes, `role: ${label(result.role)}`).toEqual(NO_WRITES)
  }
  expect(results.map((r) => r.role)).toEqual([...roles])
}

// ── reports.ts → report.create ───────────────────────────────────────────────

describe('report writes require report.create', () => {
  test('POST /api/org/:auth0Id/reports allows every report-authoring role', () => {
    expectAllowed(
      runProbe('reports.create', REPORT_CREATE_ROLES),
      201,
      'createReportRecord',
      REPORT_CREATE_ROLES,
    )
  })

  test('POST /api/org/:auth0Id/reports denies a medical member and never writes', () => {
    expectDenied(
      runProbe('reports.create', REPORT_CREATE_DENIED),
      REPORT_CREATE_MESSAGE('Creating'),
      REPORT_CREATE_DENIED,
    )
  })

  test('PUT /api/org/:auth0Id/reports/:id allows every report-authoring role', () => {
    expectAllowed(
      runProbe('reports.update', REPORT_CREATE_ROLES),
      200,
      'updateReportRecord',
      REPORT_CREATE_ROLES,
    )
  })

  test('PUT /api/org/:auth0Id/reports/:id denies a medical member and never writes', () => {
    expectDenied(
      runProbe('reports.update', REPORT_CREATE_DENIED),
      REPORT_CREATE_MESSAGE('Updating'),
      REPORT_CREATE_DENIED,
    )
  })

  test('DELETE /api/org/:auth0Id/reports/:id allows every report-authoring role', () => {
    expectAllowed(
      runProbe('reports.delete', REPORT_CREATE_ROLES),
      200,
      'deleteReport',
      REPORT_CREATE_ROLES,
    )
  })

  test('DELETE /api/org/:auth0Id/reports/:id denies a medical member and never writes', () => {
    expectDenied(
      runProbe('reports.delete', REPORT_CREATE_DENIED),
      REPORT_CREATE_MESSAGE('Deleting'),
      REPORT_CREATE_DENIED,
    )
  })
})

// ── students.ts → player.manage ──────────────────────────────────────────────

describe('roster writes require player.manage', () => {
  test('POST /api/org/:auth0Id/students allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('students.create', PLAYER_MANAGE_ROLES),
      201,
      'createStudent',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('POST /api/org/:auth0Id/students denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('students.create', PLAYER_MANAGE_DENIED),
      PLAYER_MANAGE_MESSAGE('Creating students'),
      PLAYER_MANAGE_DENIED,
    )
  })

  test('PUT /api/org/:auth0Id/students/:id allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('students.update', PLAYER_MANAGE_ROLES),
      200,
      'updateStudent',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('PUT /api/org/:auth0Id/students/:id denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('students.update', PLAYER_MANAGE_DENIED),
      PLAYER_MANAGE_MESSAGE('Updating students'),
      PLAYER_MANAGE_DENIED,
    )
  })

  test('DELETE /api/org/:auth0Id/students/:id allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('students.delete', PLAYER_MANAGE_ROLES),
      200,
      'deleteStudent',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('DELETE /api/org/:auth0Id/students/:id denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('students.delete', PLAYER_MANAGE_DENIED),
      PLAYER_MANAGE_MESSAGE('Deleting students'),
      PLAYER_MANAGE_DENIED,
    )
  })

  test('POST /api/org/:auth0Id/students/import allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('students.import', PLAYER_MANAGE_ROLES),
      200,
      'importStudents',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('POST /api/org/:auth0Id/students/import denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('students.import', PLAYER_MANAGE_DENIED),
      PLAYER_MANAGE_MESSAGE('Importing students'),
      PLAYER_MANAGE_DENIED,
    )
  })

  test('POST /api/org/:auth0Id/students/:id/performance allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('students.performance', PLAYER_MANAGE_ROLES),
      201,
      'createPerformanceMetric',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('POST /api/org/:auth0Id/students/:id/performance denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('students.performance', PLAYER_MANAGE_DENIED),
      PLAYER_MANAGE_MESSAGE('Recording performance metrics'),
      PLAYER_MANAGE_DENIED,
    )
  })
})

// ── performance.ts → player.manage ───────────────────────────────────────────

describe('cross-student performance writes require player.manage', () => {
  test('PUT /api/org/:auth0Id/performance/:id allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('performance.update', PLAYER_MANAGE_ROLES),
      200,
      'updatePerformanceMetric',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('PUT /api/org/:auth0Id/performance/:id denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('performance.update', PLAYER_MANAGE_DENIED),
      'Updating performance metrics requires the player.manage permission',
      PLAYER_MANAGE_DENIED,
    )
  })

  test('DELETE /api/org/:auth0Id/performance/:id allows the owning coaching roles', () => {
    expectAllowed(
      runProbe('performance.delete', PLAYER_MANAGE_ROLES),
      200,
      'deletePerformanceMetric',
      PLAYER_MANAGE_ROLES,
    )
  })

  test('DELETE /api/org/:auth0Id/performance/:id denies assistant coaches, analysts, medical, players and strangers', () => {
    expectDenied(
      runProbe('performance.delete', PLAYER_MANAGE_DENIED),
      'Deleting performance metrics requires the player.manage permission',
      PLAYER_MANAGE_DENIED,
    )
  })
})
