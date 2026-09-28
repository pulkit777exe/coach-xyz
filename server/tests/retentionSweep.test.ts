import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

// ── Retention completeness ──────────────────────────────────────────────────
// Storage follows the rows: deleting or pruning an analysis also sweeps its
// rendered video (the engine's DELETE /download/:id, 404-tolerant), and the
// daily sweep additionally prunes consumed/expired invites, aged
// notifications, and stages orphaned by deleted jobs — with per-table counts.
// Audit rows are never pruned by the sweep (documented in analyses.ts).
// Runs in a probe process (retentionProbe.ts) against ephemeral Postgres,
// with only the engine HTTP client stubbed.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'retentionProbe.ts')

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('retention completeness (probe)', () => {
  test('delete sweeps video, sweep prunes rows + videos + auxiliaries', () => {
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
    const result = JSON.parse(lines[lines.length - 1] ?? '') as {
      done: string[]
      engineDeletes: string[]
    }
    expect(result.done).toEqual(['delete', 'prune'])
    expect(result.engineDeletes).toEqual(['eng-del', 'eng-prune'])
  })
})
