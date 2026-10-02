import { describe, expect, test } from 'bun:test'

import { runProbeProcess } from './spawnProbe'

// The student-keyed reads and writes in routes/org/students.ts resolve a single
// student. A capability is not a scope: `player.manage` says a role may reshape
// a roster, not whose roster. Each case spawns a probe process so the probe's
// `mock.module` stubs never leak into the suite's shared module cache.
//
// Reads answer 404, so a student outside the caller's teams is
// indistinguishable from one that does not exist. Writes answer 403, beside the
// capability gate they follow.

type Role = string | null
type Result = { role: Role; status: number; writes: Record<string, number> }

const SERVER_DIR = new URL('..', import.meta.url).pathname
const PROBE = new URL('studentScopeProbe.ts', import.meta.url).pathname

const run = async (
  probeCase: string,
  roles: string[],
  extraEnv: Record<string, string> = {},
): Promise<Result[]> => {
  // Bounded by runProbeProcess rather than a bare Bun.spawn, so a wedged probe
  // costs this spawn's budget and reports the child's partial output instead of
  // surfacing as an opaque suite-level "timed out after 30000ms" with nothing.
  // See tests/spawnProbe.ts.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  const proc = await runProbeProcess({
    probe: PROBE,
    cwd: SERVER_DIR,
    env: {
      ...env,
      STUDENT_SCOPE_CASE: probeCase,
      STUDENT_SCOPE_ROLES: roles.join(','),
      ...extraEnv,
    },
  })
  if (proc.exitCode !== 0) {
    throw new Error(`probe ${probeCase} exited ${proc.exitCode}:\n${proc.stdout}\n${proc.stderr}`)
  }
  const last = proc.stdout.trim().split('\n').at(-1) ?? ''
  if (!last.startsWith('[')) {
    throw new Error(`probe ${probeCase} produced no result:\n${proc.stdout}\n${proc.stderr}`)
  }
  return JSON.parse(last) as Result[]
}

const NO_WRITES = {
  updateStudent: 0,
  deleteStudent: 0,
  createPerformanceMetric: 0,
  linkAnalysisToStudent: 0,
  createStudent: 0,
  importStudents: 0,
}

/** The team A and team B fixtures are valid, in-org teams the probe resolves. */
const ONE_WRITE = (key: 'createStudent' | 'importStudents') => ({
  ...NO_WRITES,
  [key]: 1,
})

/** Roles that hold player.manage but are narrowed to team A. */
const TEAM_COACHES = ['coach', 'head_coach', 'assistant_coach']
/** Org-wide readers: no team assignment, expected to see everything. */
const ORG_READERS = ['analyst', 'medical']
/**
 * Org-wide callers that may actually reshape a roster. NOT analyst/medical:
 * `resolveStudentScope` makes them org-wide, but `ROLE_PERMISSIONS` withholds
 * `player.manage` from both, so they are refused by the capability gate before
 * any scope question is reached. Using them here would assert 403 for a reason
 * that has nothing to do with the team rule.
 */
const ORG_MANAGERS = ['admin', 'owner']
/**
 * Team-narrowed roles that hold `player.manage`. NOT assistant_coach:
 * ASSISTANT_COACH_PERMISSIONS deliberately omits it ("cannot reshape teams or
 * manage the roster"), so that role is refused by the capability gate too.
 */
const ROSTER_MANAGERS = ['coach', 'head_coach']

describe('a team coach cannot reach a student on another team', () => {
  // Reads hide the row (404); writes refuse the action (403). Both attempt
  // nothing.
  const readCases = [
    { probeCase: 'read.performance', status: 404 },
    { probeCase: 'read.analyses', status: 404 },
    { probeCase: 'write.update', status: 403 },
    { probeCase: 'write.delete', status: 403 },
    { probeCase: 'write.performance', status: 403 },
    { probeCase: 'write.linkAnalysis', status: 403 },
  ] as const

  for (const { probeCase, status } of readCases) {
    test(`${probeCase} is ${status} for a team-A coach and attempts no write`, async () => {
      const [coach] = await run(probeCase, TEAM_COACHES)
      expect(coach?.status).toBe(status)
      expect(coach?.writes).toEqual(NO_WRITES)
    })
  }
})

describe('org staff stay org-wide', () => {
  const readCases = ['read.performance', 'read.analyses'] as const

  for (const probeCase of readCases) {
    test(`${probeCase} is not narrowed for analyst or medical`, async () => {
      const results = await run(probeCase, ORG_READERS)
      expect(results.map((r) => r.status)).toEqual([200, 200])
    })
  }
})

describe('a coach still sees their own team', () => {
  test('the performance series of an in-scope student is readable', async () => {
    // STUDENT_A sits on team A, the coach's team: narrowing must not become
    // a blanket denial.
    const results = await run('read.performance.own', TEAM_COACHES)
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
  })
})

describe('a player is not a staff caller', () => {
  test('a player cannot read another student performance series', async () => {
    const [player] = await run('read.performance', ['player'])
    expect(player?.status).toBe(404)
  })
})

// ── The team a player is FILED UNDER is scope too ────────────────────────────
// The cases above all key on an existing `student_id`. Creating a player has no
// student to resolve, so the scope question is different: which TEAM may this
// caller file a new player under. `resolveTeamId` answers only whether the team
// is in this org (its own doc comment says so — it exists to stop cross-org
// linkage), and nothing asked the scope question. The sibling PUT route did ask
// it; POST did not, so `player.manage` plus any in-org team uuid created a
// player on a team the caller is not assigned to.
describe('a team coach cannot file a player under another team', () => {
  for (const probeCase of ['create.offTeam', 'import.offTeam'] as const) {
    test(`${probeCase} is 403 and creates nothing`, async () => {
      const results = await run(probeCase, ROSTER_MANAGERS)
      expect(results.map((r) => r.status)).toEqual([403, 403])
      for (const result of results) {
        expect(result.writes).toEqual(NO_WRITES)
      }
    })
  }

  test('import.offTeam is not narrowed for an org-wide manager', async () => {
    const results = await run('import.offTeam', ORG_MANAGERS)
    expect(results.map((r) => r.status)).toEqual([200, 200])
    for (const result of results) {
      expect(result.writes).toEqual(ONE_WRITE('importStudents'))
    }
  })
})

describe('the same routes still write inside the caller scope', () => {
  // Without these the 403s above would be indistinguishable from the route
  // refusing everyone — the same reason read.performance.own exists.
  for (const { probeCase, key, status } of [
    { probeCase: 'create.ownTeam', key: 'createStudent' as const, status: 201 },
    { probeCase: 'import.ownTeam', key: 'importStudents' as const, status: 200 },
    { probeCase: 'import.rowTeam', key: 'importStudents' as const, status: 200 },
  ]) {
    test(`${probeCase} is ${status} for a team-A coach and writes once`, async () => {
      const results = await run(probeCase, ROSTER_MANAGERS)
      expect(results.map((r) => r.status)).toEqual([status, status])
      for (const result of results) {
        expect(result.writes).toEqual(ONE_WRITE(key))
      }
    })
  }

  test('a single-team coach importing with no team is defaulted onto it', async () => {
    // TEAM_FOR_ROLE gives team staff exactly one team, so the hierarchy
    // convenience POST always had applies: the import lands on the caller's own
    // team rather than on a NULL-team player they could never see.
    const results = await run('import.noTeam', ROSTER_MANAGERS)
    expect(results.map((r) => r.status)).toEqual([200, 200])
    for (const result of results) {
      expect(result.writes).toEqual(ONE_WRITE('importStudents'))
    }
  })

  test('an org-wide manager may still import players with no team at all', async () => {
    // The previous contract, preserved for callers who legitimately want
    // unassigned players.
    const results = await run('import.noTeam', ORG_MANAGERS)
    expect(results.map((r) => r.status)).toEqual([200, 200])
    for (const result of results) {
      expect(result.writes).toEqual(ONE_WRITE('importStudents'))
    }
  })

  test('a multi-team caller naming no team is refused, not defaulted to a guess', async () => {
    // The single-team convenience cannot help here: with two teams there is no
    // defensible one to pick, and guessing would file players somewhere the
    // caller did not ask for. The honest answer is to make them choose.
    const results = await run('import.noTeam', ROSTER_MANAGERS, {
      STUDENT_SCOPE_SECOND_TEAM: '00000000-0000-0000-0000-0000000000b1',
    })
    expect(results.map((r) => r.status)).toEqual([403, 403])
    for (const result of results) {
      expect(result.writes).toEqual(NO_WRITES)
    }
  })

  test('create with no team is unchanged for a team coach and for an org manager', async () => {
    const [coach, admin] = await run('create.noTeam', ['coach', 'admin'])
    expect(coach?.status).toBe(201)
    expect(admin?.status).toBe(201)
  })
})
