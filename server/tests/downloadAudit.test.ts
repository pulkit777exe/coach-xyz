import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Download audit org ───────────────────────────────────────────────────────
// The video.exported audit must name the owning org on BOTH paths: live
// Redis mapping (resolved via lookup) and expired mapping (persisted row).
// Fresh process per the mock-leak rule, bounded by runProbeProcess so a wedged
// child is reported as a probe failure (see tests/spawnProbe.ts).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'downloadAuditProbe.ts')

const runCase = async (
  scenario: string,
): Promise<{ status: number; audited: Array<{ org: string }> }> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = 'audit-token'
  env.DATABASE_URL = ''
  env.DOWNLOAD_AUDIT_CASE = scenario

  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `download audit probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<{ status: number; audited: Array<{ org: string }> }>(proc.stdout)
}

describe('download audit org', () => {
  test('live Redis mapping audits the owning org, not unknown', async () => {
    const result = await runCase('live')
    expect(result.status).toBe(200)
    expect(result.audited).toEqual([{ org: 'auth-coach-1' }])
  })

  test('expired mapping audits the persisted row org', async () => {
    const result = await runCase('expired')
    expect(result.status).toBe(200)
    expect(result.audited).toEqual([{ org: 'auth-coach-1' }])
  })
})
