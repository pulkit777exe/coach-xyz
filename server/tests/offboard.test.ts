import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Member offboarding (custodian model) ─────────────────────────────────────
// Data stays with the org; the leaver loses team rows + membership, teams go
// to a named successor or the owner custodians. Every case spawns a probe
// process, isolated from other files' `mock.module` stubs:
// - offboardPgProbe.ts: lib-level scenarios against ephemeral Postgres
//   (scope transfer, cross-org survival, re-invite, custodian, refusals,
//   rollback, player-link stability).
// - memberRoutesProbe.ts: route cases against a fixture stub (owner removal
//   with successor + notifications, self-leave + owner notification, repeat
//   calls 404 without re-notifying, invalid successor, owner/player refusals).

const SERVER_DIR = join(import.meta.dir, '..')
const PG_PROBE = join(import.meta.dir, 'offboardPgProbe.ts')
const ROUTES_PROBE = join(import.meta.dir, 'memberRoutesProbe.ts')

const spawnProbe = (
  probe: string,
  extraEnv: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  const proc = Bun.spawnSync({
    cmd: [process.execPath, probe],
    cwd: SERVER_DIR,
    env: { ...env, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  }
}

type RouteProbeResult = {
  results: Array<{ name: string; status: number }>
  notifications: Array<Record<string, unknown>>
  audits: Array<{ sql: string; values: unknown[] }>
}

const runRoutesProbe = (probeCase: string): RouteProbeResult => {
  const { exitCode, stdout, stderr } = spawnProbe(ROUTES_PROBE, {
    MEMBER_ROUTES_CASE: probeCase,
  })
  expect(exitCode, `probe failed for ${probeCase}:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as RouteProbeResult
}

const statusOf = (result: RouteProbeResult, name: string): number => {
  const entry = result.results.find((r) => r.name === name)
  expect(entry, `no result named ${name}`).toBeDefined()
  return entry?.status ?? -1
}

describe('offboard member (probe)', () => {
  test('owner removal transfers teams and notifies the successor once', () => {
    const result = runRoutesProbe('remove')
    expect(statusOf(result, 'remove')).toBe(200)
    expect(statusOf(result, 'remove-repeat')).toBe(404)
    // Exactly one notification, to the successor — the 404 repeat sends none.
    expect(result.notifications.length).toBe(1)
    expect(result.notifications[0].auth0Id).toBe('auth0|leave-successor')
    expect(result.notifications[0].dedupeKey).toBe(
      'teams-transferred:00000000-0000-4000-8000-0000000000f1',
    )
    const removed = result.audits.filter((a) => a.values.includes('member.removed'))
    expect(removed.length).toBe(1)
    expect(
      result.audits.filter((a) => a.values.includes('team.member_removed')).length,
    ).toBe(2)
  })

  test('unknown successor and owner removal are refused', () => {
    const result = runRoutesProbe('remove-invalid')
    expect(statusOf(result, 'bad-successor')).toBe(422)
    expect(statusOf(result, 'owner')).toBe(400)
    expect(result.notifications).toEqual([])
  })

  test('self-leave custodians to the owner and notifies once', () => {
    const result = runRoutesProbe('leave')
    expect(statusOf(result, 'leave')).toBe(200)
    expect(statusOf(result, 'leave-repeat')).toBe(404)
    expect(result.notifications.length).toBe(1)
    expect(result.notifications[0].auth0Id).toBe('auth0|leave-org')
    expect(result.notifications[0].dedupeKey).toBe(
      'member-left:00000000-0000-4000-8000-0000000000f1',
    )
  })

  test('leaving your own org and player self-leave are refused', () => {
    expect(statusOf(runRoutesProbe('leave-own'), 'leave-own')).toBe(400)
    expect(statusOf(runRoutesProbe('leave-player'), 'leave-player')).toBe(400)
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('offboard member against ephemeral Postgres (probe)', () => {
  test('transfer, survival, refusals, and rollback all hold', () => {
    const { exitCode, stdout, stderr } = spawnProbe(PG_PROBE, {})
    expect(exitCode, `probe failed:\n${stdout}\n${stderr}`).toBe(0)
    const lines = stdout.trim().split('\n')
    const result = JSON.parse(lines[lines.length - 1] ?? '') as { done: string[] }
    expect(result.done).toEqual([
      'successor',
      'cross-org',
      'reinvite',
      'custodian',
      'owner-refused',
      'player-refused',
      'rollback',
      'player-link',
    ])
  })
})
