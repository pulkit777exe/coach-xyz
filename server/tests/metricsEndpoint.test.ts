import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Metrics endpoint ─────────────────────────────────────────────────────────
// GET /health/metrics serves the in-memory per-route counters the composed
// app records in onAfterResponse. The probe drives the real app: one
// guard-exempt route, one 404, then the endpoint itself — all without
// credentials, proving the monitor path needs none.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'metricsEndpointProbe.ts')

describe('/health/metrics', () => {
  test('records pattern keys, folds 404s, skips health traffic', () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    env.SERVICE_TOKEN = ''
    env.DATABASE_URL = ''
    env.ENGINE_URL = ''

    const proc = Bun.spawnSync({
      cmd: [process.execPath, PROBE],
      cwd: SERVER_DIR,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = new TextDecoder().decode(proc.stdout)
    const stderr = new TextDecoder().decode(proc.stderr)
    expect(proc.exitCode, `metrics probe failed:\n${stdout}\n${stderr}`).toBe(0)
    const lines = stdout.trim().split('\n')
    const result = JSON.parse(lines[lines.length - 1] ?? '') as {
      status: number
      requestId: string | null
      positions: number
      unmatched: number
      shallowHealthKeys: string[]
    }
    expect(result.status).toBe(200)
    expect(result.requestId).toBeTruthy()
    expect(result.positions).toBeGreaterThanOrEqual(1)
    expect(result.unmatched).toBeGreaterThanOrEqual(1)
    expect(result.shallowHealthKeys).toEqual([])
  })
})
