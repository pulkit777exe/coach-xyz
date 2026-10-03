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
// Org-wide callers that ALSO hold team.manage, so a club-wide write being allowed
// is attributable to scope rather than to the capability check. analyst/medical
// alone would be refused by the capability gate before scope is consulted.
const ORG_FIXTURE_MANAGERS = ['admin', 'owner']
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

// A row with no team belongs to the ORG, and `listMatches`/`listSeasons` keep
// team-less rows visible to everyone — so authoring one writes into every
// player's calendar. The guards read `if (teamId && …)`, which short-circuits
// exactly when there is no team, and seasons had no scope check at all: a
// team-scoped coach could publish to the whole club by omitting `team_id`.
// Same rule as `eventTeamWritable` in org/schedule.ts, which names this exact
// trap. The READ asymmetry is deliberate and asserted unchanged below.
describe('a club-wide row is an org write, not a team one', () => {
  test('creating a match with no team is refused for a team coach and writes nothing', async () => {
    const results = await run('write.createNoTeam', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.creates).toBe(0)
    }
  })

  test('deleting a club-wide match is refused for a team coach and deletes nothing', async () => {
    const results = await run('write.deleteClub', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.deletes).toBe(0)
    }
  })

  test('creating a season is refused for a team coach — a season has no team at all', async () => {
    const results = await run('write.createSeason', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.creates).toBe(0)
    }
  })

  test('deleting a season is refused for a team coach', async () => {
    const results = await run('write.deleteSeason', FIXTURE_MANAGERS)
    for (const r of results) {
      expect(r.status).toBe(403)
      expect(r.deletes).toBe(0)
    }
  })

  test('an org-wide caller is unaffected by all four', async () => {
    // The negative direction: a cap that refuses everyone would pass the four
    // tests above, so prove the org still authors club-wide rows.
    for (const [probeCase, counter] of [
      ['write.createNoTeam', 'creates'],
      ['write.deleteClub', 'deletes'],
      ['write.createSeason', 'creates'],
      ['write.deleteSeason', 'deletes'],
    ] as const) {
      const results = await run(probeCase, ORG_FIXTURE_MANAGERS)
      for (const r of results) {
        expect(r.status).not.toBe(403)
        expect(r[counter]).toBe(1)
      }
    }
  })

  test('the READ is unchanged: a club-wide match stays visible to a team coach', async () => {
    // The asymmetry is the point — visible to everyone, authorable by the org.
    const [coach] = await run('read.list', TEAM_COACHES)
    const { matches } = coach!.body as { matches: { id: string; team_id: string | null }[] }
    expect(matches.some((m) => m.team_id === null)).toBe(true)
  })
})
