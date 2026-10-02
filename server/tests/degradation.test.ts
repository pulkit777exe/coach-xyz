import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Degradation contract ─────────────────────────────────────────────────────
// Everything down at once (no DATABASE_URL, Redis failing, engine
// refusing) against the real composed app. Fail-open where defaults exist
// because the store can be absent; fail-closed AND observable (shaped
// INTERNAL_ERROR envelope, never a raw message) where the store is the
// only source of truth. Fresh process per the mock-leak rule.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'degradationProbe.ts')

// The one probe that is genuinely slower than its peers: it waits out real
// connection attempts against a Redis that is refusing, so it measured ~2.4s
// where the median probe is ~0.9s. Its own budget rather than the shared one.
const DEGRADATION_TIMEOUT_MS = 20_000

type Check = { route: string; status: number; code?: unknown }

describe('degradation contract (all dependencies down)', () => {
  test('defaults serve, truth requires the store, ops sees the outage', async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    env.SERVICE_TOKEN = ''
    env.DATABASE_URL = ''
    env.ENGINE_URL = ''

    const proc = await runProbeProcess({
      probe: PROBE,
      cwd: SERVER_DIR,
      env,
      timeoutMs: DEGRADATION_TIMEOUT_MS,
    })
    expect(proc.exitCode, `degradation probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
    const { checks } = lastJsonLine<{ checks: Check[] }>(proc.stdout)
    const byRoute = Object.fromEntries(checks.map((c) => [c.route, c]))

    // Fail-open: consent/prefs defaults render with no store.
    expect(byRoute['GET /api/me/consent']).toMatchObject({ status: 200 })
    expect(byRoute['GET /api/me/notification-preferences']).toMatchObject({ status: 200 })
    // Fail-closed but shaped: the roster lives only in the store.
    expect(byRoute['GET /api/org/auth0%7Cdegraded-org/students']).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    })
    expect(byRoute['POST /api/org/auth0%7Cdegraded-org/students']).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    })
    // Engine-dependent statics degrade to empty, still 200.
    expect(byRoute['GET /api/sports/basketball/positions']).toMatchObject({ status: 200 })
    // The shaper passes 404s through untouched (body + access hook).
    expect(byRoute['GET /no-such-path']).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    // Redis down rules the 503; the body names the outage per component.
    expect(byRoute['GET /health/deep']).toMatchObject({ status: 503, code: 'unhealthy' })
    expect(JSON.parse(String(byRoute['GET /health/deep#checks']?.code))).toEqual({
      database: { ok: false, latency_ms: expect.any(Number), enabled: false },
      redis: { ok: false, latency_ms: expect.any(Number) },
    })
  })
})
