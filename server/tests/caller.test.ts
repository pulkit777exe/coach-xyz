import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { resolveCaller } from '../src/lib/caller'

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
const runOrgScopeProbe = (): OrgScopeProbeResult => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as OrgScopeProbeResult
}

describe('resolveCaller org scope (probe)', () => {
  test('a coach with teams in two orgs sees only the current org teams', () => {
    const r = runOrgScopeProbe()
    expect(r.role).toBe('coach')
    expect(r.teamIdsA).toEqual(['team-a'])
    expect(r.teamIdsB).toEqual(['team-b'])
  })

  test('the team lookup joins teams and predicates on the org', () => {
    // The cross-org leak came from a lookup with no org predicate at all; pin
    // the join so a future edit cannot silently drop it.
    const r = runOrgScopeProbe()
    const q = r.teamQueries.find((t) => t.values.includes('auth0|org-a'))
    expect(q, 'no org-A team query recorded').toBeDefined()
    expect(q?.sql).toMatch(/join teams/)
    expect(q?.sql).toMatch(/org_auth0_id/)
    expect(q?.values).toContain('auth0|two-org-coach')
  })
})
