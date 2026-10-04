// Probe: the persisted-owner backstop on the browser-direct capability routes.
//
// `verifyJobAccess` treats an EMPTY owner set as an anonymous demo job, which is
// bearer-readable by design. Before the backstop, `download.ts` and `status.ts`
// consulted the persisted row only when the Redis mapping was MISSING, so a Redis
// job with `owner_ids: []` never looked at a row that named an owner.
//
// Each case below is a different combination of Redis owner set, persisted owner,
// and caller, and each asserts one direction — including the ones that must still
// SUCCEED, because a backstop that refuses everyone is as broken as one that admits
// everyone.
//
// Prints one JSON line; the parent asserts on it.

import { mock } from 'bun:test'

const MODE = process.env.DOWNLOAD_OWNER_CASE ?? 'empty_redis_persisted_owner'

const PERSISTED_OWNER = 'auth-coach-1'

/** Redis `owner_ids` per case. `undefined` means "no Redis mapping at all". */
const redisOwnerIds: Record<string, string[] | undefined> = {
  empty_redis_persisted_owner: [],
  empty_redis_owner_is_caller: [],
  anonymous_everywhere: [],
  owned_redis_no_persisted_read: [PERSISTED_OWNER],
}

/** The persisted row per case, or `null` for "no row". */
const persistedRow: Record<string, { auth0_id: string | null } | null> = {
  empty_redis_persisted_owner: { auth0_id: PERSISTED_OWNER },
  empty_redis_owner_is_caller: { auth0_id: PERSISTED_OWNER },
  anonymous_everywhere: null,
  owned_redis_no_persisted_read: { auth0_id: PERSISTED_OWNER },
}

/** The caller's verified sub per case (what the attribution token resolves to). */
const callerSub: Record<string, string | null> = {
  empty_redis_persisted_owner: 'auth-stranger',
  empty_redis_owner_is_caller: PERSISTED_OWNER,
  anonymous_everywhere: 'auth-stranger',
  owned_redis_no_persisted_read: PERSISTED_OWNER,
}

mock.module('../src/lib/jobs', () => ({
  getJob: async () => {
    const ids = redisOwnerIds[MODE]
    if (ids === undefined) return null
    return {
      server_job_id: 'srv-1',
      engine_job_id: 'eng-1',
      session_token: null,
      player_index: null,
      model: 'm',
      created_at: Date.now(),
      owner_ids: ids,
    }
  },
}))

let persistedReads = 0
mock.module('../src/lib/analyses', () => ({
  markAnalysisDownloaded: async () => undefined,
  getAnalysisByServerJobId: async () => {
    persistedReads += 1
    // The fast-path case asserts the backstop is NOT consulted by making a read
    // an error: if the route queries anyway, the probe fails loudly instead of
    // quietly paying for a query nobody needed.
    if (MODE === 'owned_redis_no_persisted_read') {
      throw new Error('persisted row was read on the fast path')
    }
    const row = persistedRow[MODE]
    if (!row) return null
    return {
      server_job_id: 'srv-1',
      auth0_id: row.auth0_id,
      requested_by: null,
      engine_job_id: 'eng-1',
      summary_json: {},
      display_name: null,
      requested_at: new Date().toISOString(),
      model: 'm',
      video_ready: true,
    }
  },
}))

// The attribution module is what resolves a caller, so stub the verifier rather
// than minting real HMAC tokens: the case is about WHICH owner set is consulted,
// not about the token's cryptography (which tests/attribution*.test.ts owns).
const sub = callerSub[MODE]
mock.module('../src/lib/attribution', () => ({
  verifyAttributionToken: (token: string | null) => (token === 'good-token' ? sub : null),
  mintAttributionToken: () => 'good-token',
}))

mock.module('../src/lib/engineClient', () => ({
  getDownloadStream: async () =>
    new Response(Buffer.from('fake-mp4'), {
      headers: { 'content-type': 'video/mp4', 'content-length': '7' },
    }),
}))

const { downloadRoute } = await import('../src/routes/download')

const res = await downloadRoute().handle(
  new Request('http://probe.test/api/download/srv-1', {
    headers: { 'x-attribution': 'good-token' },
  }),
)

console.log(JSON.stringify({ status: res.status, caller: sub, persistedReads }))
process.exit(0)
