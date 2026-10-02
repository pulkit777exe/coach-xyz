import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Org-keyed analysis admission ─────────────────────────────────────────────
// An invited coach names the club (`org_auth0_id`): the row is keyed by the
// club with the coach as requester, quota/priority charge the club, and the
// org owner joins the job's owner set. Non-members and roles without
// `analysis.create` are refused before anything is admitted or enqueued.
// Runs in a probe process (analyzeOrgProbe.ts), isolated from other files'
// `mock.module` stubs and bounded by runProbeProcess (tests/spawnProbe.ts);
// attribution is real, admission + enqueue captured.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'analyzeOrgProbe.ts')

const CLUB = 'auth0|analyze-club'
const COACH = 'auth0|analyze-coach'

type ProbeResult = {
  result: { status: number }
  admitted: Array<{ orgAuth0Id: string; basePriority: number }>
  enqueued: Array<{ owner_ids: string[] }>
  persisted: Array<{ auth0_id: unknown; requested_by: unknown }>
}

const runProbe = async (probeCase: string): Promise<ProbeResult> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.ANALYZE_ORG_CASE = probeCase

  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<ProbeResult>(proc.stdout)
}

describe('analyze-video org ownership (probe)', () => {
  test('an invited coach analyzes for the club, not their own sub', async () => {
    const { result, admitted, enqueued, persisted } = await runProbe('club')
    expect(result.status).toBe(200)
    // Quota and priority charge the club.
    expect(admitted).toEqual([{ orgAuth0Id: CLUB, basePriority: 5 }])
    // The org owner reads status, chat and download through the owner set.
    expect(enqueued).toEqual([{ owner_ids: [CLUB, COACH] }])
    // The row is keyed by the club with the coach as requester.
    expect(persisted).toEqual([{ auth0_id: CLUB, requested_by: COACH }])
  })

  test('a non-member naming the club is refused before any write', async () => {
    const { result, admitted, enqueued, persisted } = await runProbe('foreign')
    expect(result.status).toBe(403)
    expect(admitted).toEqual([])
    expect(enqueued).toEqual([])
    expect(persisted).toEqual([])
  })

  test('a member without analysis.create is refused before any write', async () => {
    const { result, admitted, enqueued, persisted } = await runProbe('no-permission')
    expect(result.status).toBe(403)
    expect(admitted).toEqual([])
    expect(enqueued).toEqual([])
    expect(persisted).toEqual([])
  })

  test('omitting the org keeps the legacy shape (requested_by null)', async () => {
    const { result, persisted } = await runProbe('legacy')
    expect(result.status).toBe(200)
    expect(persisted).toEqual([{ auth0_id: CLUB, requested_by: null }])
  })

  test('anonymous callers behave exactly as before', async () => {
    const { result, admitted, enqueued, persisted } = await runProbe('anonymous')
    expect(result.status).toBe(200)
    expect(admitted).toEqual([])
    expect(enqueued).toEqual([{ owner_ids: [] }])
    expect(persisted).toEqual([{ auth0_id: null, requested_by: null }])
  })
})
