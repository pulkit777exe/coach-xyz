import { describe, expect, test } from 'bun:test'

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

const run = async (probeCase: string, roles: string[]): Promise<Result[]> => {
  const proc = Bun.spawn(['bun', 'run', 'tests/studentScopeProbe.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      STUDENT_SCOPE_CASE: probeCase,
      STUDENT_SCOPE_ROLES: roles.join(','),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  await proc.exited
  const last = out.trim().split('\n').at(-1) ?? ''
  if (!last.startsWith('[')) throw new Error(`probe ${probeCase} produced no result: ${err}`)
  return JSON.parse(last) as Result[]
}

const NO_WRITES = {
  updateStudent: 0,
  deleteStudent: 0,
  createPerformanceMetric: 0,
  linkAnalysisToStudent: 0,
  // The probe counts every write the students route could attempt, so a
  // refused request is asserted against all of them. `createStudent` and
  // `importStudents` arrived with the probe's counters; leaving them out here
  // made `expect(writes).toEqual(NO_WRITES)` fail on the two extra keys
  // (`toEqual` is exact, not a subset) for every case.
  createStudent: 0,
  importStudents: 0,
}

/** Roles that hold player.manage but are narrowed to team A. */
const TEAM_COACHES = ['coach', 'head_coach', 'assistant_coach']
/** Org-wide readers: no team assignment, expected to see everything. */
const ORG_READERS = ['analyst', 'medical']

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
