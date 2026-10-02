import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { resolveCaller } from '../src/lib/caller'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

const OWNER = 'auth0|owner-1'

const requestWith = (verified: string | null): Request =>
  new Request('http://localhost/api/org/x/teams', {
    headers: verified ? { 'x-verified-auth0-id': verified } : {},
  })

describe('resolveCaller', () => {
  test('owner fast-path resolves without membership rows', async () => {
    const caller = await resolveCaller(OWNER, requestWith(OWNER))
    expect(caller.verified).toBe(OWNER)
    expect(caller.role).toBe('owner')
    expect(caller.can('team.create')).toBe(true)
    expect(caller.canAccessTeam('any-team')).toBe(true)
    expect(caller.studentScope).toEqual({ all: true })
  })

  test('missing identity resolves to an unauthorized caller', async () => {
    const caller = await resolveCaller(OWNER, requestWith(null))
    expect(caller.verified).toBeNull()
    expect(caller.role).toBeNull()
    expect(caller.teamIds).toEqual([])
    expect(caller.can('team.read')).toBe(false)
    expect(caller.canAccessTeam('any-team')).toBe(false)
    expect(caller.studentScope).toEqual({ all: false, teamIds: [] })
  })
})

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'callerOrgScopeProbe.ts')

type OrgScopeProbeResult = {
  role: string | null
  teamIdsA: string[]
  teamIdsB: string[]
  teamQueries: Array<{ sql: string; values: unknown[] }>
}

// A coach holding teams in two orgs, resolved in a probe process: the store
// stub emulates Postgres filtering by the bound org, and the probe pattern
// keeps other files' `mock.module` stubs from leaking in.
//
// The spawn is bounded by `runProbeProcess` rather than `Bun.spawnSync`: see
// tests/spawnProbe.ts for why a blocking spawn turns one stuck child into a
// 30s, output-free suite-level timeout.
const runOrgScopeProbe = async (): Promise<OrgScopeProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''

  const run = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(run.exitCode, `probe failed:\n${run.stdout}\n${run.stderr}`).toBe(0)
  return lastJsonLine<OrgScopeProbeResult>(run.stdout)
}

describe('resolveCaller org scope (probe)', () => {
  test('a coach with teams in two orgs sees only the current org teams', async () => {
    const r = await runOrgScopeProbe()
    expect(r.role).toBe('coach')
    expect(r.teamIdsA).toEqual(['team-a'])
    expect(r.teamIdsB).toEqual(['team-b'])
  })

  test('the team lookup joins teams and predicates on the org', async () => {
    // The cross-org leak came from a lookup with no org predicate at all; pin
    // the join so a future edit cannot silently drop it.
    const r = await runOrgScopeProbe()
    const q = r.teamQueries.find((t) => t.values.includes('auth0|org-a'))
    expect(q, 'no org-A team query recorded').toBeDefined()
    expect(q?.sql).toMatch(/join teams/)
    expect(q?.sql).toMatch(/org_auth0_id/)
    expect(q?.values).toContain('auth0|two-org-coach')
  })
})
