import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Deep health ──────────────────────────────────────────────────────────────
// /health/deep reports per-component status for ops monitoring: redis,
// database, engine, queue depth. Shallow /health stays a fast 200 for the
// platform probe. Each scenario runs the real route in a fresh process
// (probe isolation: redis connects on import, so it must be stubbed).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'healthDeepProbe.ts')

type DeepBody = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    redis: { ok: boolean }
    database: { ok: boolean }
    engine: { ok: boolean }
    queue: { ok: boolean; waiting: number; failed: number }
  }
}

const runCase = (scenario: string): { status: number; body: DeepBody } => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ENGINE_URL = ''
  env.HEALTH_DEEP_CASE = scenario

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `health probe failed for ${scenario}:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as { status: number; body: DeepBody }
}

describe('/health/deep', () => {
  test('healthy when every backend answers', () => {
    const { status, body } = runCase('all-up')
    expect(status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.checks.redis.ok).toBe(true)
    expect(body.checks.database.ok).toBe(true)
    expect(body.checks.engine.ok).toBe(true)
  })

  test('redis down is unhealthy (503)', () => {
    const { status, body } = runCase('redis-down')
    expect(status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.checks.redis.ok).toBe(false)
  })

  test('database down degrades (200), Redis still rules the 503', () => {
    const { status, body } = runCase('db-down')
    expect(status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.database.ok).toBe(false)
    expect(body.checks.redis.ok).toBe(true)
  })

  test('engine down degrades (200)', () => {
    const { status, body } = runCase('engine-down')
    expect(status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.engine.ok).toBe(false)
  })
})
