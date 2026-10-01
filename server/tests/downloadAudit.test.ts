import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Download audit org ───────────────────────────────────────────────────────
// The video.exported audit must name the owning org on BOTH paths: live
// Redis mapping (resolved via lookup) and expired mapping (persisted row).
// Fresh process per the mock-leak rule.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'downloadAuditProbe.ts')

const runCase = (scenario: string): { status: number; audited: Array<{ org: string }> } => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = 'audit-token'
  env.DATABASE_URL = ''
  env.DOWNLOAD_AUDIT_CASE = scenario

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `download audit probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as {
    status: number
    audited: Array<{ org: string }>
  }
}

describe('download audit org', () => {
  test('live Redis mapping audits the owning org, not unknown', () => {
    const result = runCase('live')
    expect(result.status).toBe(200)
    expect(result.audited).toEqual([{ org: 'auth-coach-1' }])
  })

  test('expired mapping audits the persisted row org', () => {
    const result = runCase('expired')
    expect(result.status).toBe(200)
    expect(result.audited).toEqual([{ org: 'auth-coach-1' }])
  })
})
