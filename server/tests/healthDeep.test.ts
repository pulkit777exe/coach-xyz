import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Deep health ──────────────────────────────────────────────────────────────
// /health/deep reports per-component status for ops monitoring: redis,
// database, engine, queue depth. Shallow /health stays a fast 200 for the
// platform probe. Each scenario runs the real route in a fresh process
// (probe isolation: redis connects on import, so it must be stubbed).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'healthDeepProbe.ts')

// One of the two probes slower than the median (~0.9s): each scenario reports
// on a backend that is down, so it pays the connection timeout. Measured ~2.2s
// locally, hence its own budget rather than the shared one.
const HEALTH_DEEP_TIMEOUT_MS = 20_000

type DeepBody = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    redis: { ok: boolean }
    database: { ok: boolean }
    engine: { ok: boolean }
    queue: { ok: boolean; waiting: number; failed: number }
  }
}

const runCase = async (scenario: string): Promise<{ status: number; body: DeepBody }> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ENGINE_URL = ''
  env.HEALTH_DEEP_CASE = scenario

  const proc = await runProbeProcess({
    probe: PROBE,
    cwd: SERVER_DIR,
    env,
    timeoutMs: HEALTH_DEEP_TIMEOUT_MS,
  })
  expect(
    proc.exitCode,
    `health probe failed for ${scenario}:\n${proc.stdout}\n${proc.stderr}`,
  ).toBe(0)
  return lastJsonLine<{ status: number; body: DeepBody }>(proc.stdout)
}

describe('/health/deep', () => {
  test('healthy when every backend answers', async () => {
    const { status, body } = await runCase('all-up')
    expect(status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(body.checks.redis.ok).toBe(true)
    expect(body.checks.database.ok).toBe(true)
    expect(body.checks.engine.ok).toBe(true)
  })

  test('redis down is unhealthy (503)', async () => {
    const { status, body } = await runCase('redis-down')
    expect(status).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.checks.redis.ok).toBe(false)
  })

  test('database down degrades (200), Redis still rules the 503', async () => {
    const { status, body } = await runCase('db-down')
    expect(status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.database.ok).toBe(false)
    expect(body.checks.redis.ok).toBe(true)
  })

  test('engine down degrades (200)', async () => {
    const { status, body } = await runCase('engine-down')
    expect(status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.engine.ok).toBe(false)
  })
})
