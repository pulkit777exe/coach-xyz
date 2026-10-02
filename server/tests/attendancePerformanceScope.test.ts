import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Team scope for attendance + performance ──────────────────────────────────
// Capability is not scope. `attendance.write` / `player.manage` said WHICH
// writes a role may make, never WHOSE students they may name, so a coach
// assigned to team A could read — and write — team B's attendance and metrics by
// guessing a student id. Every student-keyed read now passes the caller's
// visible ids into SQL, and every write gates on `canSeeStudent` before the
// store is touched.
//
// The probe (attendancePerformanceScopeProbe.ts) runs in a fresh Bun process per
// case so its `mock.module` store/identity stubs cannot leak into the rest of
// the suite's shared module cache. It keeps the REAL `resolveCaller`, the REAL
// `permissions.ts` matrix and the REAL `lib/org/scope.ts` seam (whose ids come
// from the stub roster), so an "allowed" case proves the route's own check
// agreed with the policy instead of with a hard-coded id list.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'attendancePerformanceScopeProbe.ts')

const ORG = 'auth0|org-owner'
const TEAM_A = '00000000-0000-4000-8000-00000000000a'
const STUDENT_A = '00000000-0000-4000-8000-0000000000a1'
const STUDENT_B = '00000000-0000-4000-8000-0000000000b1'

type CallKey =
  | 'listAttendance'
  | 'attendanceSummary'
  | 'upsertAttendance'
  | 'setAttendanceBatch'
  | 'deleteAttendance'
  | 'notifyAttendanceRecorded'
  | 'getStudent'
  | 'listPerformance'
  | 'getStudentTrends'
  | 'compareStudents'
  | 'getPerformanceMetric'
  | 'updatePerformanceMetric'
  | 'deletePerformanceMetric'

type ProbeResult = {
  case: string
  role: OrgMemberRole | null
  teams: string[]
  target: 'teamA' | 'teamB'
  status: number
  body: unknown
  /** The `studentIds` filter each student-keyed read received (null = org-wide). */
  filters: Record<string, string[] | null>
  calls: Record<CallKey, number>
  scopeLookups: Array<{ auth0Id: string; teamIds: string[] }>
}

const NO_CALLS: Record<CallKey, number> = {
  listAttendance: 0,
  attendanceSummary: 0,
  upsertAttendance: 0,
  setAttendanceBatch: 0,
  deleteAttendance: 0,
  notifyAttendanceRecorded: 0,
  getStudent: 0,
  getStudentsByIds: 0,
  listPerformance: 0,
  getStudentTrends: 0,
  compareStudents: 0,
  getPerformanceMetric: 0,
  updatePerformanceMetric: 0,
  deletePerformanceMetric: 0,
}

/** A coach on team A only; the target student defaults to team A. */
type RunOptions = {
  role: OrgMemberRole | null
  teams?: string[]
  target?: 'teamA' | 'teamB'
}

const runProbe = (probeCase: string, opts: RunOptions): ProbeResult => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ATT_PERF_SCOPE_CASE = probeCase
  env.ATT_PERF_SCOPE_ROLE = opts.role ?? '__non_member__'
  env.ATT_PERF_SCOPE_TEAMS = (opts.teams ?? []).join(',')
  env.ATT_PERF_SCOPE_TARGET = opts.target ?? 'teamA'

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
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult
}

/** The coach is on team A; the request targets a team B student by default. */
const runAsTeamACoach = (probeCase: string, target: 'teamA' | 'teamB' = 'teamB'): ProbeResult =>
  runProbe(probeCase, { role: 'coach', teams: [TEAM_A], target })

const forbidden = (message: string) => ({
  code: 'FORBIDDEN',
  message,
  layer: 'server',
  retryable: false,
})

const ATTENDANCE_SCOPE_MESSAGE =
  'Recording attendance is limited to the students in your team scope'
const PERFORMANCE_SCOPE_MESSAGE =
  'Performance metrics are limited to the students in your team scope'

const studentIdsIn = (body: unknown): string[] => {
  const rows = (body as { records: Array<{ student_id: string }> }).records
  return rows.map((r) => r.student_id)
}

// ── Reads: a team coach sees only their own team ─────────────────────────────

describe('attendance reads are narrowed to the caller teams', () => {
  test('a team A coach lists only team A attendance, and team B rows are absent', () => {
    const result = runAsTeamACoach('attendance.list')
    expect(result.status).toBe(200)
    expect(result.filters.listAttendance).toEqual([STUDENT_A])
    expect(studentIdsIn(result.body)).toEqual([STUDENT_A])
    expect(studentIdsIn(result.body)).not.toContain(STUDENT_B)
  })

  test('the attendance summary counts only team A records', () => {
    const result = runAsTeamACoach('attendance.summary')
    expect(result.status).toBe(200)
    expect(result.filters.attendanceSummary).toEqual([STUDENT_A])
    // Two records exist in the org (one per team): scoping to the one visible
    // student must drop the team B row from the totals.
    expect(result.body).toEqual({
      summary: {
        total_records: 1,
        present: 1,
        absent: 0,
        late: 0,
        excused: 0,
        attendance_rate: 100,
      },
    })
  })

  test('naming another team in the query cannot widen the list', () => {
    // The org-wide `studentId` filter and the scope filter are ANDed in SQL, so
    // a team B student yields nothing rather than that student's rows.
    const result = runProbe('attendance.list', {
      role: 'coach',
      teams: [TEAM_A],
      target: 'teamB',
    })
    expect(result.status).toBe(200)
    expect(result.filters.listAttendance).toEqual([STUDENT_A])
    expect(studentIdsIn(result.body)).not.toContain(STUDENT_B)
  })
})

describe('performance reads are narrowed to the caller teams', () => {
  test('a team A coach gets no metrics for a team B student', () => {
    const result = runAsTeamACoach('performance.list')
    expect(result.status).toBe(200)
    expect(result.filters.listPerformance).toEqual([STUDENT_A])
    expect(result.body).toEqual({ metrics: [] })
  })

  test('a team A coach gets the metrics of their own student', () => {
    const result = runAsTeamACoach('performance.list', 'teamA')
    expect(result.status).toBe(200)
    expect(result.filters.listPerformance).toEqual([STUDENT_A])
    expect((result.body as { metrics: Array<{ student_id: string }> }).metrics).toHaveLength(1)
  })

  test('a team A coach gets no trends for a team B student', () => {
    const result = runAsTeamACoach('performance.trends')
    expect(result.status).toBe(200)
    expect(result.filters.getStudentTrends).toEqual([STUDENT_A])
    expect(result.body).toEqual({ trends: [] })
  })

  test('a team A coach gets the trends of their own student', () => {
    const result = runAsTeamACoach('performance.trends', 'teamA')
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      trends: [
        {
          metric_key: 'sprint_time',
          latest: 7,
          avg: 7,
          change: 0,
          direction: 'flat',
          points: [{ measured_at: '2026-03-01T00:00:00.000Z', metric_value: 7 }],
          student_id: STUDENT_A,
        },
      ],
    })
  })

  test('comparison silently drops the students a scoped caller cannot see', () => {
    const result = runAsTeamACoach('performance.comparison')
    expect(result.status).toBe(200)
    const comparison = (result.body as { comparison: Array<{ student_id: string }> }).comparison
    expect(comparison.map((c) => c.student_id)).toEqual([STUDENT_A])
  })
})

// ── Writes: 403 before the store is touched ──────────────────────────────────

describe('attendance writes refuse a student outside the caller scope', () => {
  test('PUT /attendance: 403 and no store call at all', () => {
    const result = runAsTeamACoach('attendance.put')
    expect(result.status).toBe(403)
    expect(result.body).toEqual(forbidden(ATTENDANCE_SCOPE_MESSAGE))
    // Not even the roster lookup happens: the write is refused before the store.
    expect(result.calls).toEqual(NO_CALLS)
  })

  test('POST /attendance/batch: one out-of-scope entry refuses the whole batch', () => {
    const result = runAsTeamACoach('attendance.batch')
    expect(result.status).toBe(403)
    expect(result.body).toEqual(forbidden(ATTENDANCE_SCOPE_MESSAGE))
    expect(result.calls).toEqual(NO_CALLS)
  })

  test('DELETE /attendance: 403 and no delete attempted', () => {
    const result = runAsTeamACoach('attendance.delete')
    expect(result.status).toBe(403)
    expect(result.body).toEqual(forbidden(ATTENDANCE_SCOPE_MESSAGE))
    expect(result.calls).toEqual(NO_CALLS)
  })
})

describe('performance writes refuse a student outside the caller scope', () => {
  test('PUT /performance/:id: 403 and no update attempted', () => {
    const result = runAsTeamACoach('performance.update')
    expect(result.status).toBe(403)
    expect(result.body).toEqual(forbidden(PERFORMANCE_SCOPE_MESSAGE))
    expect(result.calls.updatePerformanceMetric).toBe(0)
    // The metric id is resolved to its student first — a read, never a write.
    expect(result.calls.getPerformanceMetric).toBe(1)
  })

  test('DELETE /performance/:id: 403 and no delete attempted', () => {
    const result = runAsTeamACoach('performance.delete')
    expect(result.status).toBe(403)
    expect(result.body).toEqual(forbidden(PERFORMANCE_SCOPE_MESSAGE))
    expect(result.calls.deletePerformanceMetric).toBe(0)
    expect(result.calls.getPerformanceMetric).toBe(1)
  })
})

describe('the same routes still work inside the caller scope', () => {
  test('a team A coach records attendance for a team A student', () => {
    const result = runAsTeamACoach('attendance.put', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.upsertAttendance).toBe(1)
    expect(result.calls.getStudent).toBe(1)
  })

  test('a team A coach batches attendance for a team A student', () => {
    const result = runAsTeamACoach('attendance.batch', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.setAttendanceBatch).toBe(1)
  })

  // The batch size cap. `setAttendanceBatch` upserts one entry at a time in a
  // sequential loop, so an uncapped array turns a single request into an
  // unbounded number of round trips — the route checked only `length > 0`
  // before. Both cases below target a student the caller CAN see, with
  // individually valid entries, so size is the only thing separating them.
  test('a batch one entry over the cap is refused before any write', () => {
    const result = runAsTeamACoach('attendance.batchOverCap', 'teamA')
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ code: 'INVALID_REQUEST' })
    // The load-bearing assertion: the cap has to fire before the loop, not
    // after it has already issued 501 upserts.
    expect(result.calls.setAttendanceBatch).toBe(0)
  })

  test('a batch of exactly MAX_ATTENDANCE_BATCH is still accepted', () => {
    const result = runAsTeamACoach('attendance.batchAtCap', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.setAttendanceBatch).toBe(1)
  })

  test('a team A coach deletes attendance for a team A student', () => {
    const result = runAsTeamACoach('attendance.delete', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.deleteAttendance).toBe(1)
  })

  test('a team A coach updates a team A metric', () => {
    const result = runAsTeamACoach('performance.update', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.updatePerformanceMetric).toBe(1)
  })

  test('a team A coach deletes a team A metric', () => {
    const result = runAsTeamACoach('performance.delete', 'teamA')
    expect(result.status).toBe(200)
    expect(result.calls.deletePerformanceMetric).toBe(1)
  })
})

// ── Org-wide staff and owners are NOT narrowed ──────────────────────────────

describe('org-wide roles read the whole org', () => {
  for (const role of ['analyst', 'medical'] as const) {
    test(`${role} is not narrowed: both teams are visible and unscoped`, () => {
      const list = runProbe('attendance.list', { role, teams: [] })
      expect(list.status).toBe(200)
      expect(list.filters.listAttendance).toBeNull()
      expect(studentIdsIn(list.body).sort()).toEqual([STUDENT_A, STUDENT_B])
      // Org-wide means `null`, and `null` costs no roster lookup at all.
      expect(list.scopeLookups).toEqual([])

      const summary = runProbe('attendance.summary', { role, teams: [] })
      expect(summary.filters.attendanceSummary).toBeNull()
      expect(summary.body).toEqual({
        summary: {
          total_records: 2,
          present: 2,
          absent: 0,
          late: 0,
          excused: 0,
          attendance_rate: 100,
        },
      })

      const trends = runProbe('performance.trends', { role, teams: [], target: 'teamB' })
      expect(trends.status).toBe(200)
      expect(trends.filters.getStudentTrends).toBeNull()
      expect((trends.body as { trends: unknown[] }).trends).toHaveLength(1)
    })
  }

  test('analyst and medical cannot write attendance (capability, unchanged)', () => {
    // Scope is a second gate; the permission matrix still refuses the write.
    for (const role of ['analyst', 'medical'] as const) {
      const result = runProbe('attendance.put', { role, teams: [] })
      expect(result.status).toBe(403)
      expect(result.body).toEqual(
        forbidden('Recording attendance requires the attendance.write permission'),
      )
      expect(result.calls).toEqual(NO_CALLS)
    }
  })
})

describe('owner is unaffected', () => {
  test('owner lists the whole org without a scope lookup', () => {
    const result = runProbe('attendance.list', { role: 'owner', teams: [], target: 'teamB' })
    expect(result.status).toBe(200)
    expect(result.filters.listAttendance).toBeNull()
    expect(studentIdsIn(result.body).sort()).toEqual([STUDENT_A, STUDENT_B])
    expect(result.scopeLookups).toEqual([])
  })

  test('owner writes attendance for a student on any team', () => {
    const result = runProbe('attendance.put', { role: 'owner', teams: [], target: 'teamB' })
    expect(result.status).toBe(200)
    expect(result.calls.upsertAttendance).toBe(1)
  })

  test('owner updates a metric on any team', () => {
    const result = runProbe('performance.update', { role: 'owner', teams: [], target: 'teamB' })
    expect(result.status).toBe(200)
    expect(result.calls.updatePerformanceMetric).toBe(1)
  })
})

// ── A coach who manages no team manages nobody ──────────────────────────────

describe('an unassigned coach sees nothing and writes nothing', () => {
  test('attendance list is empty and the filter is an empty list, not null', () => {
    const result = runProbe('attendance.list', { role: 'head_coach', teams: [] })
    expect(result.status).toBe(200)
    // `[]` (sees nobody) must stay distinct from `null` (org-wide).
    expect(result.filters.listAttendance).toEqual([])
    expect(studentIdsIn(result.body)).toEqual([])
  })

  test('the attendance summary counts nothing', () => {
    const result = runProbe('attendance.summary', { role: 'coach', teams: [] })
    expect(result.status).toBe(200)
    expect(result.filters.attendanceSummary).toEqual([])
    expect((result.body as { summary: { total_records: number } }).summary.total_records).toBe(0)
  })

  test('trends for any student are empty', () => {
    const result = runProbe('performance.trends', { role: 'coach', teams: [], target: 'teamB' })
    expect(result.status).toBe(200)
    expect(result.filters.getStudentTrends).toEqual([])
    expect(result.body).toEqual({ trends: [] })
  })

  test('attendance writes are refused with the scope 403, not the capability one', () => {
    for (const probeCase of ['attendance.put', 'attendance.batch', 'attendance.delete']) {
      const result = runProbe(probeCase, { role: 'coach', teams: [], target: 'teamA' })
      expect(result.status, probeCase).toBe(403)
      expect(result.body, probeCase).toEqual(forbidden(ATTENDANCE_SCOPE_MESSAGE))
      expect(result.calls, probeCase).toEqual(NO_CALLS)
    }
  })

  test('performance writes are refused with the scope 403', () => {
    const cases = [
      ['performance.update', 'updatePerformanceMetric'],
      ['performance.delete', 'deletePerformanceMetric'],
    ] as const
    for (const [probeCase, writeKey] of cases) {
      const result = runProbe(probeCase, { role: 'coach', teams: [], target: 'teamA' })
      expect(result.status, probeCase).toBe(403)
      expect(result.body, probeCase).toEqual(forbidden(PERFORMANCE_SCOPE_MESSAGE))
      expect(result.calls[writeKey], probeCase).toBe(0)
    }
  })
})

// ── Capability and scope are independent gates ───────────────────────────────

describe('capability is still checked before scope', () => {
  test('a player member is denied on capability even inside their own team', () => {
    // `player` has no attendance.write; the capability guard is the first
    // question asked, so its message must survive the new second gate.
    const result = runProbe('attendance.put', {
      role: 'player',
      teams: [TEAM_A],
      target: 'teamA',
    })
    expect(result.status).toBe(403)
    expect(result.body).toEqual(
      forbidden('Recording attendance requires the attendance.write permission'),
    )
    expect(result.calls).toEqual(NO_CALLS)
  })

  test('a non-member resolves to no scope and reaches no student', () => {
    const result = runProbe('attendance.list', { role: null, teams: [] })
    expect(result.status).toBe(200)
    // A non-member resolves to no role: no capability, no teams, no visibility.
    expect(result.role).toBeNull()
    expect(result.filters.listAttendance).toEqual([])
    expect(studentIdsIn(result.body)).toEqual([])
    expect(result.scopeLookups).toEqual([])
  })
})

describe('the org in the path is the org being scoped', () => {
  test('the visible-id lookup runs against the org from the path', () => {
    const result = runAsTeamACoach('attendance.list')
    expect(result.scopeLookups).toEqual([{ auth0Id: ORG, teamIds: [TEAM_A] }])
  })
})
