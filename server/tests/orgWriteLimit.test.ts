import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { runProbeProcess } from './spawnProbe'

// ── Org-write rate limit ─────────────────────────────────────────────────────
// The global orgWriteRateLimit plugin holds mutating org/email/account-tree
// traffic to a per-caller per-minute budget; reads never consume it. Both
// probes run the real plugin + limiter with Redis down (in-memory
// fallback), in fresh processes per the mock-leak rule, bounded by
// runProbeProcess so a wedged child is a probe failure (see tests/spawnProbe.ts).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'orgWriteLimitProbe.ts')
const APP_PROBE = join(import.meta.dir, 'orgWriteLimitAppProbe.ts')

const spawnEnv = (): Record<string, string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  return env
}

const runProbe = async (probe: string): Promise<string> => {
  const proc = await runProbeProcess({ probe, cwd: SERVER_DIR, env: spawnEnv() })
  expect(proc.exitCode, `limit probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  const lines = proc.stdout.trim().split('\n')
  return lines[lines.length - 1] ?? ''
}

describe('org-write rate limit', () => {
  test('budget of 3: three writes pass, reads are free, callers are isolated', async () => {
    const result = JSON.parse(await runProbe(PROBE)) as {
      statuses: number[]
      code: unknown
      retryAfter: unknown
    }
    expect(result.statuses.slice(0, 3)).toEqual([200, 200, 200])
    expect(result.statuses[3]).toBe(429)
    expect(result.code).toBe('RATE_LIMITED')
    expect(result.retryAfter).toBeGreaterThan(0)
    expect(result.statuses.slice(4, 9)).toEqual([200, 200, 200, 200, 200])
    expect(result.statuses[9]).toBe(200)
  })

  test('composed app: limiter covers mounted routes (registration order)', async () => {
    // Budget of 2 against the real buildApp: the first two writes reach
    // the handler (400 on the empty body, never a 429), the third is
    // refused, and the read passes through to the (storeless) handler.
    const result = JSON.parse(await runProbe(APP_PROBE)) as { statuses: number[] }
    expect(result.statuses[0]).not.toBe(429)
    expect(result.statuses[1]).not.toBe(429)
    expect(result.statuses[2]).toBe(429)
    expect(result.statuses[3]).not.toBe(429)
  })
})
