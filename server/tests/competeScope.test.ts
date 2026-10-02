import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// Match fixtures and the team list carry a team dimension, so a team coach must
// see their own rows and not another team's. `team.manage` is a capability, not
// a scope: it says a role may manage fixtures, not another team's.
//
// A match with no team is a club-level fixture and stays org-wide, the same
// rule the objectives/plans filter uses for a row that belongs to nobody.
//
// The probe spawn is bounded by runProbeProcess so a wedged child is a probe
// failure carrying its output, not an opaque suite timeout (tests/spawnProbe.ts).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'competeScopeProbe.ts')

type Result = {
  role: string | null
  status: number
  deletes: number
  creates: number
  body: unknown
}

const run = async (probeCase: string, roles: string[]): Promise<Result[]> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.COMPETE_SCOPE_CASE = probeCase
  env.COMPETE_SCOPE_ROLES = roles.join(',')
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe ${probeCase} failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<Result[]>(proc.stdout)
}

const TEAM_COACHES = ['coach', 'head_coach', 'assistant_coach']
// Write cases use only roles that hold team.manage, so a refusal is attributable
// to the scope check rather than to the capability check. assistant_coach
// deliberately lacks team.manage and is denied before scope is consulted.
const FIXTURE_MANAGERS = ['coach', 'head_coach']
const ORG_READERS = ['analyst', 'medical']
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'

describe('a team coach sees only their own fixtures', () => {
  test('the match list omits another team but keeps the club fixture', async () => {
    const [coach] = await run('read.list', TEAM_COACHES)
    expect(coach?.status).toBe(200)
    const { matches } = coach!.body as { matches: { team_id: string | null }[] }
    const teams = matches.map((m) => m.team_id)
    expect(teams).toContain(TEAM_A)
    expect(teams).not.toContain(TEAM_B)
    // A team-less match is a club fixture: hiding it would be over-narrowing.
    expect(teams).toContain(null)
  })

  test('org staff still see every match', async () => {
    const results = await run('read.list', ORG_READERS)
    for (const r of results) {
      const { matches } = r.body as { matches: { team_id: string | null }[] }
      expect(matches.map((m) => m.team_id)).toContain(TEAM_B)
    }
  })

  test('creating a fixture for another team is refused and writes nothing', async () => {
    const results = await run('write.createOtherTeam', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.creates).toBe(0)
    }
  })

  test('creating a fixture for their own team still works', async () => {
    const results = await run('write.createOwnTeam', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(201)
      expect(r.creates).toBe(1)
    }
  })

  test("deleting another team's fixture is refused and deletes nothing", async () => {
    const results = await run('write.deleteOtherTeam', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.deletes).toBe(0)
    }
  })
})

describe('the team list follows the same policy', () => {
  test('a team coach sees only their own team', async () => {
    const [coach] = await run('read.teams', TEAM_COACHES)
    const { teams } = coach!.body as { teams: { id: string }[] }
    expect(teams.map((t) => t.id)).toEqual([TEAM_A])
  })

  test('org staff see every team, not an empty list', async () => {
    // Regression guard: filtering the list by raw membership ids rather than
    // canAccessTeam showed org staff nothing while their member reads worked.
    const results = await run('read.teams', ORG_READERS)
    for (const r of results) {
      const { teams } = r.body as { teams: { id: string }[] }
      expect(teams.map((t) => t.id).sort()).toEqual([TEAM_A, TEAM_B].sort())
    }
  })
})
