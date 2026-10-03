import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'

import { runProbeProcess } from './spawnProbe'
import { listReports } from '../src/lib/org/reports'
import { getObjective, listObjectives, objectiveVisibleTo } from '../src/lib/org/objectives'
import { getTrainingPlan, listTrainingPlans, planVisibleTo } from '../src/lib/org/plans'
import { MAX_ORG_LIST_ROWS } from '../src/lib/orgValidate'

// ── Org team scope: reports, objectives, training plans ────────────────────────
// Capability is not scope. `report.create` / `player.manage` decide WHETHER a
// caller may author at all; `resolveStudentScope` decides WHOSE. Before this
// change every read in these three domains was org-wide and every write was
// gated only by the capability, so a coach assigned to team A could read and
// write team B's rows by guessing a student id.
//
// Three layers, each proving what it can and nothing more. Layer 1 used to live
// in this file; it is now orgTeamScopeLive.test.ts, because a suite that mixes a
// live database with process-spawning probes has two coupled costs — enabling the
// live half made every probe spawn here jump to exactly PROBE_TIMEOUT_MS, which
// is what got the gate fix reverted in f6b16fd. Read that file's header before
// moving anything back.
//
//   1. live-DB (orgTeamScopeLive.test.ts, gated on the ephemeral Postgres): the
//      REAL SQL runs against REAL rows, so "team B rows are absent" and "a
//      team-level objective IS the team A coach's" are observed, not simulated.
//   2. store-stub SQL: the emitted query text and the BOUND parameters, which
//      pins the team_id-OR-student_id rule, the empty-scope NULL binding, and
//      that an org-wide caller is not narrowed at all.
//   3. route probe (fresh process, real resolveCaller + permissions + scope
//      seam + write-side predicates): what each handler hands the data layer,
//      and that a refused write never reaches it.
//
// `studentScopeProbe.ts` (the students/performance agent) owns the roster
// paths; this file owns the three coach-authored document domains.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'orgTeamScopeProbe.ts')

// Fixture world, mirrored in the probe.
const ORG = 'auth0|org-team-scope-test'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const STUDENT_A = '00000000-0000-0000-0000-0000000000a2'
const STUDENT_B = '00000000-0000-0000-0000-0000000000b2'
const UNASSIGNED = '__unassigned_coach__'

const forbidden = (message: string) => ({
  code: 'FORBIDDEN',
  message,
  layer: 'server',
  retryable: false,
})

const REPORT_SCOPE_MESSAGE = 'Reports are limited to students in your team scope'
const OBJECTIVE_SCOPE_MESSAGE =
  'Training objectives are limited to students and teams in your scope'
const PLAN_SCOPE_MESSAGE = 'Training plans are limited to students and teams in your scope'
const REPORT_CREATE_MESSAGE = (action: 'Creating' | 'Updating' | 'Deleting') =>
  `${action} reports requires the report.create permission`
const PLAYER_MANAGE_MESSAGE = (domain: 'objectives' | 'plans') =>
  `Managing training ${domain} requires player.manage`

// ── Probe harness ────────────────────────────────────────────────────────────

type WriteKey =
  | 'createReportRecord'
  | 'updateReportRecord'
  | 'deleteReport'
  | 'createObjective'
  | 'setObjectiveStatus'
  | 'deleteObjective'
  | 'createTrainingPlan'
  | 'setTrainingPlanStatus'
  | 'deleteTrainingPlan'

const NO_WRITES: Record<WriteKey, number> = {
  createReportRecord: 0,
  updateReportRecord: 0,
  deleteReport: 0,
  createObjective: 0,
  setObjectiveStatus: 0,
  deleteObjective: 0,
  createTrainingPlan: 0,
  setTrainingPlanStatus: 0,
  deleteTrainingPlan: 0,
}

type ProbeResult = {
  role: string
  status: number
  body: unknown
  writes: Record<WriteKey, number>
  reads: { getReport: number; getObjective: number; getTrainingPlan: number }
  storeQueries: number
  listOpts: unknown
  createInput: unknown
}

const runProbe = async (probeCase: string, roles: readonly string[]): Promise<ProbeResult[]> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ORG_TEAM_SCOPE_CASE = probeCase
  env.ORG_TEAM_SCOPE_ROLES = roles.join(',')

  // Bounded by runProbeProcess rather than Bun.spawnSync: the blocking spawn is
  // why a wedged probe used to cost the whole 30s suite budget with no output.
  // This file also carries a header explaining why the live-DB half lives in
  // orgTeamScopeLive.test.ts instead of here — that separation is load-bearing.
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  const lines = proc.stdout.trim().split('\n')
  const results = JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult[]
  expect(results.length).toBe(roles.length)
  return results
}

const byRole = (results: ProbeResult[], role: string): ProbeResult => {
  const found = results.find((r) => r.role === role)
  expect(found, `no probe result for role ${role}`).toBeDefined()
  return found as ProbeResult
}

// A coach on team A: sees team A's student, must not see team B's.
const COACH_A = 'coach'
// The same role with no team membership — the empty visible set.
const COACH_NONE = UNASSIGNED
/** Org-wide readers: the policy says they see the whole org, unassigned. */
const ORG_WIDE_READERS: readonly string[] = ['analyst', 'medical']

// ── 2. The emitted SQL and its bound parameters ──────────────────────────────

/** Renders a Bun tagged template the way Postgres sees it: $1, $2, … */
const numbered = (strings: TemplateStringsArray, values: unknown[]): string => {
  let next = 0
  return strings.reduce((acc, part) => acc + part + (next < values.length ? `$${++next}` : ''), '')
}

type Captured = { sql: string; values: unknown[] }

/**
 * The `= any(...::uuid[])` binding: `uuidArrayLiteral` (lib/org/scope.ts), the
 * shared owner of the pattern. A raw JS array reaches Postgres as comma-joined
 * TEXT and the cast fails with `22P02 malformed array literal` — verified live.
 */
const arrayLiteral = (ids: readonly string[]): string => `{${ids.join(',')}}`

const isNull = (v: unknown): v is null => v === null

const capture = async (fn: () => Promise<unknown>): Promise<Captured> => {
  const captured: Captured = { sql: '', values: [] }
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.sql = numbered(strings, values)
    captured.values = values
    return Promise.resolve([])
  }) as unknown as SQL
  // ensureInitialized runs DDL through the same connection before the callback,
  // so the stub implements exactly the members the wrapper touches.
  Object.assign(tag, {
    connect: async () => {},
    unsafe: async () => [],
    close: async () => {},
  })
  const restore = setHistoryStoreConnectionForTests(tag)
  try {
    await fn()
  } finally {
    restore()
  }
  return captured
}

describe('scoped reads bind the scope, and an org-wide read binds nothing', () => {
  /** The `$n` placeholder a column's `= any(...)` binds, per the emitted SQL. */
  const anyPlaceholder = (sql: string, column: string): number => {
    const match = new RegExp(`${column} = any\\(\\$(\\d+)`).exec(sql)
    expect(match, `no "${column} = any($n)" in:\n${sql}`).not.toBeNull()
    return Number((match as RegExpExecArray)[1])
  }

  test('listObjectives binds both the team and the student array', async () => {
    const { sql, values } = await capture(() =>
      listObjectives(ORG, { scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] } }),
    )
    // The OR rule, in the query — not just one of the two columns.
    expect(sql).toContain('or coalesce(team_id = any($')
    expect(sql).toContain('or coalesce(student_id = any($')
    expect(sql).toMatch(/not \$\d+/)

    const teamNo = anyPlaceholder(sql, 'team_id')
    const studentNo = anyPlaceholder(sql, 'student_id')
    expect(teamNo).not.toBe(studentNo)
    // The right literal is bound at the right placeholder.
    expect(values[teamNo - 1]).toBe(arrayLiteral([TEAM_A]))
    expect(values[studentNo - 1]).toBe(arrayLiteral([STUDENT_A]))
    // The scope flag is bound as a parameter, not interpolated into the SQL text.
    const flag = /not \$(\d+)/.exec(sql)
    expect(values[Number((flag as RegExpExecArray)[1]) - 1]).toBe(true)
  })

  test('listTrainingPlans binds the same OR rule', async () => {
    const { sql, values } = await capture(() =>
      listTrainingPlans(ORG, { scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] } }),
    )
    expect(sql).toContain('or coalesce(team_id = any($')
    expect(sql).toContain('or coalesce(student_id = any($')
    expect(values).toContain(true)
  })

  test('ids bind as a Postgres array LITERAL, never as a bare JS array', async () => {
    // Regression, verified against live Postgres in the group above: Bun sends a
    // bare JS array as one comma-joined TEXT value, so
    // `= any(${['a','b']}::uuid[])` fails with `22P02 malformed array literal` —
    // a 500 on every scoped read, worst for the non-empty case that matters.
    // `uuidArrayLiteral` is the shared owner of the correct binding.
    for (const [fn, columns] of [
      [
        (opts: Parameters<typeof listObjectives>[1]) => listObjectives(ORG, opts),
        ['team_id', 'student_id'],
      ],
      [
        (opts: Parameters<typeof listTrainingPlans>[1]) => listTrainingPlans(ORG, opts),
        ['team_id', 'student_id'],
      ],
    ] as const) {
      const captured = await capture(() =>
        fn({ scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] } }),
      )
      for (const column of columns) {
        const bound = captured.values[anyPlaceholder(captured.sql, column) - 1]
        // A Postgres array literal, i.e. a string — not a JS array.
        expect(typeof bound, `${column} was not an array literal`).toBe('string')
        expect(bound as string).toMatch(/^\{.*\}$/)
      }
      // Not one bare JS array anywhere in the bound values.
      expect(captured.values.some((v) => Array.isArray(v))).toBe(false)
    }
  })

  test('an empty scope binds NULL, so `= any(NULL)` matches nothing', async () => {
    const { values } = await capture(() =>
      listObjectives(ORG, { scope: { teamIds: [], studentIds: [] } }),
    )
    // The unassigned coach reaches the store with "no teams" — NULL, which
    // `= any(...)` rejects. Not a bare array (500), and not a literal that could
    // read as "unscoped".
    expect(values.filter(isNull).length).toBeGreaterThanOrEqual(2)
    expect(values.some((v) => Array.isArray(v))).toBe(false)
    expect(values.some((v) => typeof v === 'string' && v.startsWith('{'))).toBe(false)
    expect(values).toContain(true)
  })

  test('an org-wide caller is not narrowed at all: scope flag false, arrays NULL', async () => {
    for (const [fn, sql] of [
      [(opts: Parameters<typeof listObjectives>[1]) => listObjectives(ORG, opts), 'team_id = any('],
      [
        (opts: Parameters<typeof listTrainingPlans>[1]) => listTrainingPlans(ORG, opts),
        'team_id = any(',
      ],
    ] as const) {
      const captured = await capture(() => fn({}))
      // `not false` short-circuits the whole clause, so the NULLs are never
      // consulted — the query reads the org, not an empty set.
      expect(captured.values).toContain(false)
      expect(captured.values.some((v) => Array.isArray(v))).toBe(false)
      expect(captured.sql).toContain(sql)
    }
    const reports = await capture(() => listReports(ORG))
    expect(reports.values).toContain(false)
    expect(reports.sql).toContain('r.student_id = any($')
  })

  test('listReports binds only the student array — a report has no team', async () => {
    const { sql, values } = await capture(() =>
      listReports(ORG, { visibleStudentIds: [STUDENT_A] }),
    )
    // Student-only visibility, unlike objectives/plans: reports carry no team_id.
    expect(sql).not.toContain('team_id = any(')
    expect(values[anyPlaceholder(sql, 'r\\.student_id') - 1]).toBe(arrayLiteral([STUDENT_A]))
    expect(values).toContain(true)
  })
})

// ── 3. The write-side predicate: the same rule, in pure form ──────────────────

describe('objectiveVisibleTo / planVisibleTo (the write-side twin of the SQL rule)', () => {
  const teamA: { all: false; teamIds: string[] } = { all: false, teamIds: [TEAM_A] }
  const unassigned: { all: false; teamIds: string[] } = { all: false, teamIds: [] }
  const orgWide: { all: true } = { all: true }
  const visibleA = [STUDENT_A]

  test("a team-level row is the team coach's even though it has no student", () => {
    expect(objectiveVisibleTo(teamA, visibleA, { team_id: TEAM_A, student_id: null })).toBe(true)
    expect(planVisibleTo(teamA, visibleA, { team_id: TEAM_A, student_id: null })).toBe(true)
  })

  test('a student-level row is visible through the student half, team column null', () => {
    expect(objectiveVisibleTo(teamA, visibleA, { team_id: null, student_id: STUDENT_A })).toBe(true)
    expect(objectiveVisibleTo(teamA, visibleA, { team_id: null, student_id: STUDENT_B })).toBe(
      false,
    )
  })

  test('a row on another team is refused, and so is an org-level row', () => {
    expect(objectiveVisibleTo(teamA, visibleA, { team_id: TEAM_B, student_id: null })).toBe(false)
    expect(objectiveVisibleTo(teamA, visibleA, { team_id: null, student_id: null })).toBe(false)
    expect(planVisibleTo(teamA, visibleA, { team_id: null, student_id: null })).toBe(false)
  })

  test('an unassigned coach sees nothing at all', () => {
    expect(objectiveVisibleTo(unassigned, [], { team_id: TEAM_A, student_id: null })).toBe(false)
    expect(objectiveVisibleTo(unassigned, [], { team_id: null, student_id: STUDENT_A })).toBe(false)
  })

  test('an org-wide caller is allowed everything, including org-level rows', () => {
    expect(objectiveVisibleTo(orgWide, null, { team_id: null, student_id: null })).toBe(true)
    expect(objectiveVisibleTo(orgWide, null, { team_id: TEAM_B, student_id: null })).toBe(true)
    expect(planVisibleTo(orgWide, null, { team_id: null, student_id: null })).toBe(true)
  })
})

// ── 4. Route wiring: the handler hands the data layer the right narrowing ─────

describe("org reads hand the data layer the caller's real visible set", () => {
  test("a team A coach lists only team A reports; team B's report is absent", async () => {
    const [coach] = await runProbe('reports.list', [COACH_A])
    expect(coach.status).toBe(200)
    expect(
      (coach.body as { reports: Array<{ title: string }> }).reports.map((r) => r.title),
    ).toEqual(['Report a3'])
    // The seam actually ran (one roster query) and the ids it returned were bound.
    expect(coach.storeQueries).toBe(1)
    // `limit` is the readListLimit default, not an absence: the data layer reads a
    // missing limit as SQL NULL (unlimited) and no web caller ever sent one.
    expect(coach.listOpts).toEqual({
      studentId: undefined,
      visibleStudentIds: [STUDENT_A],
      limit: MAX_ORG_LIST_ROWS,
    })
  })

  test('a team A coach lists only team A objectives, including the team-level row', async () => {
    const [coach] = await runProbe('objectives.list', [COACH_A])
    expect(coach.status).toBe(200)
    const rows = (coach.body as { objectives: Array<{ title: string }> }).objectives
    expect(rows.map((r) => r.title).sort()).toEqual(['Objective a4'])
    expect(coach.listOpts).toEqual({
      studentId: null,
      teamId: null,
      status: null,
      scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] },
    })
  })

  test('a team A coach lists only team A plans', async () => {
    const [coach] = await runProbe('plans.list', [COACH_A])
    expect((coach.body as { plans: Array<{ title: string }> }).plans.map((p) => p.title)).toEqual([
      'Plan a6',
    ])
    expect(coach.listOpts).toEqual({
      teamId: null,
      studentId: null,
      scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] },
    })
  })

  test('the existing query-param filters survive alongside the scope', async () => {
    const [coach] = await runProbe('objectives.list.filters', [COACH_A])
    expect(coach.listOpts).toEqual({
      studentId: null,
      teamId: TEAM_A,
      status: 'active',
      scope: { teamIds: [TEAM_A], studentIds: [STUDENT_A] },
    })
  })

  test('analyst and medical read the whole org and are NOT narrowed', async () => {
    const results = await runProbe('objectives.list', ORG_WIDE_READERS)
    for (const role of ORG_WIDE_READERS) {
      const result = byRole(results, role)
      expect(result.status, role).toBe(200)
      expect(result.listOpts, role).toEqual({
        studentId: null,
        teamId: null,
        status: null,
        scope: undefined,
      })
      // No scope key at all — and the roster lookup was never made, because
      // visibleStudentIds short-circuits for an org-wide scope.
      expect(Object.keys(result.listOpts as object), role).not.toContain('scope')
      expect(result.storeQueries, role).toBe(0)
      expect((result.body as { objectives: unknown[] }).objectives.length, role).toBe(3)
    }
    const [reports] = await runProbe('reports.list', ORG_WIDE_READERS)
    expect(Object.keys(reports.listOpts as object)).not.toContain('visibleStudentIds')
    expect(reports.storeQueries).toBe(0)
  })

  test('owner is unaffected: org-wide reads, all fixture rows', async () => {
    const results = await runProbe('objectives.list', ['owner', 'admin'])
    for (const role of ['owner', 'admin']) {
      const result = byRole(results, role)
      expect(result.listOpts, role).toEqual({
        studentId: null,
        teamId: null,
        status: null,
        scope: undefined,
      })
      expect((result.body as { objectives: unknown[] }).objectives.length, role).toBe(3)
    }
  })

  test('an unassigned coach is narrowed to the empty set — not the whole org', async () => {
    const [coach] = await runProbe('objectives.list', [COACH_NONE])
    expect(coach.listOpts).toEqual({
      studentId: null,
      teamId: null,
      status: null,
      scope: { teamIds: [], studentIds: [] },
    })
    expect((coach.body as { objectives: unknown[] }).objectives).toEqual([])
  })

  test('GET a single report for a team B student reads as 404 to a team A coach', async () => {
    const results = await runProbe('reports.read.teamB', [COACH_A, COACH_NONE, 'analyst', 'owner'])
    expect(byRole(results, COACH_A).status).toBe(404)
    expect(byRole(results, COACH_A).body).toEqual({
      code: 'NOT_FOUND',
      message: 'Report not found',
      layer: 'server',
      retryable: false,
    })
    expect(byRole(results, COACH_NONE).status).toBe(404)
    expect(byRole(results, 'analyst').status).toBe(200)
    expect(byRole(results, 'owner').status).toBe(200)
  })
})

describe('out-of-scope writes are refused with 403 and never reach the store', () => {
  test('a team A coach cannot author a report for a team B student', async () => {
    const [coach] = await runProbe('reports.create.teamB', [COACH_A])
    expect(coach.status).toBe(403)
    expect(coach.body).toEqual(forbidden(REPORT_SCOPE_MESSAGE))
    expect(coach.writes).toEqual(NO_WRITES)
    expect(coach.createInput).toBeNull()
  })

  test('a team A coach cannot author an org-wide report either', async () => {
    const [coach] = await runProbe('reports.create.org', [COACH_A])
    expect(coach.status).toBe(403)
    expect(coach.body).toEqual(forbidden(REPORT_SCOPE_MESSAGE))
    expect(coach.writes).toEqual(NO_WRITES)
  })

  test('the same coach CAN author for its own student', async () => {
    const [coach] = await runProbe('reports.create.own', [COACH_A])
    expect(coach.status).toBe(201)
    expect(coach.writes.createReportRecord).toBe(1)
    expect(coach.createInput).toMatchObject({ student_id: STUDENT_A })
  })

  test('an unassigned coach is refused on every report write', async () => {
    const results = await runProbe('reports.create.own', [COACH_NONE])
    expect(byRole(results, COACH_NONE).status).toBe(403)
    expect(byRole(results, COACH_NONE).writes).toEqual(NO_WRITES)
  })

  test('PUT and DELETE a team B report are refused, after a fetch, before any write', async () => {
    for (const probeCase of ['reports.update.teamB', 'reports.delete.teamB']) {
      const [coach] = await runProbe(probeCase, [COACH_A])
      expect(coach.status, probeCase).toBe(403)
      expect(coach.body, probeCase).toEqual(forbidden(REPORT_SCOPE_MESSAGE))
      expect(coach.writes, probeCase).toEqual(NO_WRITES)
      // Fetch-then-check: the row WAS read (unscoped), the write was not reached.
      expect(coach.reads.getReport, probeCase).toBe(1)
    }
  })

  test('objective and plan writes for a team B student are refused with no write', async () => {
    for (const [probeCase, message] of [
      ['objectives.create.teamB', OBJECTIVE_SCOPE_MESSAGE],
      ['objectives.patch.teamB', OBJECTIVE_SCOPE_MESSAGE],
      ['objectives.delete.teamB', OBJECTIVE_SCOPE_MESSAGE],
      ['plans.create.teamB', PLAN_SCOPE_MESSAGE],
      ['plans.patch.teamB', PLAN_SCOPE_MESSAGE],
      ['plans.delete.teamB', PLAN_SCOPE_MESSAGE],
    ] as const) {
      const [coach] = await runProbe(probeCase, [COACH_A])
      expect(coach.status, probeCase).toBe(403)
      expect(coach.body, probeCase).toEqual(forbidden(message))
      expect(coach.writes, probeCase).toEqual(NO_WRITES)
      expect(coach.createInput, probeCase).toBeNull()
    }
  })

  test('PATCH/DELETE of an out-of-scope row read the row first (fetch-then-check)', async () => {
    const [objective] = await runProbe('objectives.patch.teamB', [COACH_A])
    expect(objective.reads.getObjective).toBe(1)
    const [plan] = await runProbe('plans.delete.teamB', [COACH_A])
    expect(plan.reads.getTrainingPlan).toBe(1)
  })

  test('a team-level write for its OWN team is allowed — the team half of the OR', async () => {
    for (const [probeCase, writeKey] of [
      ['objectives.create.teamA', 'createObjective'],
      ['plans.create.teamA', 'createTrainingPlan'],
    ] as const) {
      const [coach] = await runProbe(probeCase, [COACH_A])
      expect(coach.status, probeCase).toBe(201)
      expect(coach.writes[writeKey], probeCase).toBe(1)
      expect(coach.createInput, probeCase).toMatchObject({ team_id: TEAM_A })
    }
    const [patch] = await runProbe('objectives.patch.own', [COACH_A])
    expect(patch.status).toBe(200)
    expect(patch.writes.setObjectiveStatus).toBe(1)
  })

  test('an org-level objective write is refused for a scoped coach', async () => {
    const [coach] = await runProbe('objectives.create.org', [COACH_A])
    expect(coach.status).toBe(403)
    expect(coach.body).toEqual(forbidden(OBJECTIVE_SCOPE_MESSAGE))
    expect(coach.writes).toEqual(NO_WRITES)
  })

  test('an unassigned coach is refused on objective and plan writes', async () => {
    for (const probeCase of [
      'objectives.create.teamA',
      'plans.create.teamA',
      'objectives.patch.teamB',
      'plans.delete.teamB',
    ]) {
      const [coach] = await runProbe(probeCase, [COACH_NONE])
      expect(coach.status, probeCase).toBe(403)
      expect(coach.writes, probeCase).toEqual(NO_WRITES)
    }
  })

  test('owner is unaffected by the scope check on every write', async () => {
    for (const [probeCase, status] of [
      ['reports.create.teamB', 201],
      ['reports.update.teamB', 200],
      ['reports.delete.teamB', 200],
      ['objectives.create.teamB', 201],
      ['objectives.patch.teamB', 200],
      ['objectives.delete.teamB', 200],
      ['plans.create.teamB', 201],
      ['plans.patch.teamB', 200],
      ['plans.delete.teamB', 200],
    ] as const) {
      const [owner] = await runProbe(probeCase, ['owner'])
      expect(owner.status, probeCase).toBe(status)
      expect(
        Object.values(owner.writes).reduce((a, b) => a + b, 0),
        probeCase,
      ).toBe(1)
    }
  })

  test('the capability guard is untouched: analyst writes reports, medical may not', async () => {
    // report.create: analyst has it, medical does not — the 403 body proves which
    // guard answered, so the scope check did not replace the permission check.
    const [analyst] = await runProbe('reports.create.teamB', ['analyst'])
    expect(analyst.status).toBe(201)
    expect(analyst.writes.createReportRecord).toBe(1)
    for (const probeCase of [
      'reports.create.teamB',
      'reports.update.teamB',
      'reports.delete.teamB',
    ]) {
      const [medical] = await runProbe(probeCase, ['medical'])
      expect(medical.status, probeCase).toBe(403)
      expect(medical.body, probeCase).toEqual(
        forbidden(
          REPORT_CREATE_MESSAGE(
            probeCase === 'reports.create.teamB'
              ? 'Creating'
              : probeCase === 'reports.update.teamB'
                ? 'Updating'
                : 'Deleting',
          ),
        ),
      )
      expect(medical.writes, probeCase).toEqual(NO_WRITES)
    }
  })

  test('player.manage still answers before scope for objective and plan writes', async () => {
    for (const [probeCase, domain] of [
      ['objectives.create.teamA', 'objectives'],
      ['objectives.patch.own', 'objectives'],
      ['plans.create.teamA', 'plans'],
      ['plans.patch.teamB', 'plans'],
    ] as const) {
      // An analyst has report.create but NOT player.manage, and no teams.
      const [analyst] = await runProbe(probeCase, ['analyst'])
      expect(analyst.status, probeCase).toBe(403)
      expect(analyst.body, probeCase).toEqual(forbidden(PLAYER_MANAGE_MESSAGE(domain)))
      expect(analyst.writes, probeCase).toEqual(NO_WRITES)
    }
  })

  test('a non-member is refused on write and reads nothing', async () => {
    const [reads] = await runProbe('objectives.list', ['__non_member__'])
    expect((reads.body as { objectives: unknown[] }).objectives).toEqual([])
    for (const probeCase of ['objectives.create.teamA', 'plans.patch.teamB']) {
      const [stranger] = await runProbe(probeCase, ['__non_member__'])
      expect(stranger.status, probeCase).toBe(403)
      expect(stranger.writes, probeCase).toEqual(NO_WRITES)
    }
  })
})

describe('the unscoped single-row reads the write paths depend on', () => {
  test('getObjective / getTrainingPlan read by id without a scope filter', async () => {
    const objective = await capture(() => getObjective(ORG, '00000000-0000-0000-0000-000000000001'))
    expect(objective.sql).toContain('from training_objectives')
    expect(objective.sql).toContain('and id = $2')
    // No narrowing: the route applies the scope rule to the fetched row, so a
    // refusal can be 403 rather than a 404 that hides whether the row exists.
    expect(objective.values).not.toContain(true)
    expect(objective.sql).not.toContain('any(')
    const plan = await capture(() => getTrainingPlan(ORG, '00000000-0000-0000-0000-000000000001'))
    expect(plan.sql).toContain('from training_plans')
    expect(plan.sql).not.toContain('any(')
  })
})
