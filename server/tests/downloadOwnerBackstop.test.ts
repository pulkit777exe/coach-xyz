import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── An empty owner set must not be the only thing standing between a video and
// anyone holding its job id ───────────────────────────────────────────────────
//
// `verifyJobAccess` treats an EMPTY owner set as an anonymous demo job, which is
// bearer-readable by design. Both `download.ts` and `status.ts` used to consult the
// persisted row ONLY when the Redis mapping was MISSING, and `status.ts` passed
// `serverJob` alone — so a Redis job whose `owner_ids` is empty never looked at the
// database, even when that row names an owner.
//
// Today that is unreachable: `analyze.ts` seeds `owner_ids` from
// `[orgAuth0Id, owner].filter(Boolean)` and `orgAuth0Id` falls back to the verified
// sub, so an authenticated kickoff always produces a non-empty set. That is the
// point — the guarantee was resting entirely on one array at write time, with no
// second source, while `ServerJob.owner_ids` is optional and `enqueueAnalysis`
// persists `job.owner_ids ?? []`.
//
// These cases pin the READ path so it no longer depends on the WRITE path: the
// fixture below is precisely the divergence, and the persisted owner must win.
//
// One probe process per case, per the mock-leak rule, bounded by runProbeProcess so
// a wedged child is named rather than surfacing as a suite timeout.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'downloadOwnerBackstopProbe.ts')

const runCase = async (scenario: string): Promise<{ status: number; caller: string | null }> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = 'backstop-token'
  env.DATABASE_URL = ''
  env.DOWNLOAD_OWNER_CASE = scenario

  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<{ status: number; caller: string | null }>(proc.stdout)
}

describe('a job with an empty owner set still consults the persisted row', () => {
  test('a stranger is refused when Redis says anonymous but the row names an owner', async () => {
    // THE case. Redis `owner_ids: []` reads as "anonymous demo job" on its own, and
    // the database row says `auth0_id: auth-coach-1`. Before the backstop, the 403
    // came only from the route's own gates and the read path never looked.
    //
    // Read the failure mode carefully if this goes red: WITHOUT the backstop the
    // stranger is not refused with 403, it is refused with 503 — because
    // `verifyJobAccess` returned ok and the route carried on past authorization to
    // stream the video. So a non-403 here means AUTHORIZATION PASSED, not that the
    // status code was wrong. That is the whole point of this test.
    const r = await runCase('empty_redis_persisted_owner')
    expect(
      r.status,
      'a stranger must be refused; any other status means the access check passed',
    ).toBe(403)
  })

  test('the owner themselves is still let through', async () => {
    // The negative direction: a backstop that refuses everyone would be as broken
    // as one that admits everyone, and it is the shape a "fail closed" fix takes
    // when nobody tests the owner.
    const r = await runCase('empty_redis_owner_is_caller')
    expect(r.status).not.toBe(403)
  })

  test('a genuinely anonymous job (no owner anywhere) stays bearer-readable', async () => {
    // The demo flow must survive the hardening, or the fix has broken a feature.
    const r = await runCase('anonymous_everywhere')
    expect(r.status).not.toBe(403)
  })

  test('a non-empty owner set needs no database backstop', async () => {
    // And the fast path stays fast: with owners present the persisted row is not
    // consulted at all, so this is asserted by having the stub THROW if reached.
    const r = await runCase('owned_redis_no_persisted_read')
    expect(r.status).not.toBe(403)
  })
})
