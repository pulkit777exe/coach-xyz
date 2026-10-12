import { afterEach, describe, expect, test } from 'bun:test'

import type { AnalysisPayload } from '../src/lib/queue'
import { admitAnalysis, type AdmissionSeams } from '../src/lib/admission'
import { mintAttributionToken } from '../src/lib/attribution'
import { verifyJobAccess } from '../src/lib/jobAccess'

const SECRET = 'test-admission-secret'
const OWNER = 'auth0|admission-owner'
const ORG = 'auth0|admission-org'

const setToken = (value: string | undefined): void => {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

afterEach(() => {
  setToken(undefined)
})

const tokenFor = (sub: string): string => {
  const minted = mintAttributionToken(sub, SECRET)
  if (!minted) throw new Error('failed to mint test attribution token')
  return minted.token
}

const VALID_BODY = { session_token: null, player_index: null }

const analyzeRequest = (body: unknown, owner: string | null = null): Request => {
  const headers: Record<string, string> = {}
  if (owner !== null) headers['x-attribution'] = tokenFor(owner)
  return new Request('http://localhost/api/analyze-video', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// In-memory rate seam: Map-backed hit counter with a blocklist.
const makeRate = (blocked: string[] = []) => {
  const hits = new Map<string, number>()
  return {
    hits,
    check: async (key: string): Promise<{ allowed: boolean; reset: number }> => {
      hits.set(key, (hits.get(key) ?? 0) + 1)
      if (blocked.includes(key)) return { allowed: false, reset: Date.now() + 45_000 }
      return { allowed: true, reset: Date.now() + 3_600_000 }
    },
  }
}

// Array-sink queue seam.
const makeQueue = () => {
  const jobs: AnalysisPayload[] = []
  return {
    jobs,
    enqueue: async (job: AnalysisPayload): Promise<void> => {
      jobs.push(job)
    },
  }
}

// Scripted store seam: memberships, quota verdict, tier, plus call ledgers.
const makeStore = (
  script: {
    memberships?: Array<{ org_auth0_id: string }>
    membershipsError?: boolean
    quota?: { allowed: boolean; retryAfterSec: number }
    tier?: 'free' | 'pro' | 'elite'
    tierError?: boolean
  } = {},
) => {
  const persisted: unknown[] = []
  const usage: Array<{ org: string; kind: string }> = []
  return {
    persisted,
    usage,
    memberships: async (): Promise<Array<{ org_auth0_id: string }>> => {
      if (script.membershipsError) throw new Error('store down')
      return script.memberships ?? []
    },
    quota: async (): Promise<{ allowed: boolean; retryAfterSec: number }> =>
      script.quota ?? { allowed: true, retryAfterSec: 0 },
    tier: async (): Promise<'free' | 'pro' | 'elite'> => {
      if (script.tierError) throw new Error('store down')
      return script.tier ?? 'free'
    },
    persistStart: async (record: unknown): Promise<void> => {
      persisted.push(record)
    },
    recordUsage: async (org: string, kind: string): Promise<void> => {
      usage.push({ org, kind })
    },
  }
}

const makeSeams = (
  rate: ReturnType<typeof makeRate>,
  queue: ReturnType<typeof makeQueue>,
  store: ReturnType<typeof makeStore>,
): AdmissionSeams => ({ rate, queue, store })

describe('admitAnalysis', () => {
  test('anonymous caller is admitted with priority 0 and no owners', async () => {
    setToken(SECRET)
    const rate = makeRate()
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY) },
      makeSeams(rate, queue, store),
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.serverJobId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(queue.jobs).toHaveLength(1)
    expect(queue.jobs[0].priority).toBe(0)
    expect(queue.jobs[0].owner_ids).toEqual([])
    expect(queue.jobs[0].server_job_id).toBe(outcome.serverJobId)
    expect(store.persisted).toHaveLength(1)
    expect(store.usage).toEqual([])
    // Anonymous callers are rate-keyed by IP (no forwarding headers here).
    expect([...rate.hits.keys()]).toEqual(['anonymous'])
  })

  test('signed callers outrank anonymous; paid tiers outrank free', async () => {
    setToken(SECRET)
    const cases = [
      { tier: 'free', expected: 5 },
      { tier: 'pro', expected: 10 },
      { tier: 'elite', expected: 15 },
    ] as const
    for (const { tier, expected } of cases) {
      const rate = makeRate()
      const queue = makeQueue()
      const store = makeStore({ memberships: [{ org_auth0_id: ORG }], tier })
      const outcome = await admitAnalysis(
        { request: analyzeRequest(VALID_BODY, OWNER) },
        makeSeams(rate, queue, store),
      )
      expect(outcome.ok).toBe(true)
      expect(queue.jobs).toHaveLength(1)
      expect(queue.jobs[0].priority).toBe(expected)
      expect(queue.jobs[0].owner_ids).toEqual([OWNER])
      // Attributed callers are rate-keyed by sub, not IP.
      expect([...rate.hits.keys()]).toEqual([OWNER])
    }
  })

  test('org quota exhaustion rejects with 429 and enqueues nothing', async () => {
    setToken(SECRET)
    const rate = makeRate()
    const queue = makeQueue()
    const store = makeStore({
      memberships: [{ org_auth0_id: ORG }],
      quota: { allowed: false, retryAfterSec: 99 },
      tier: 'elite',
    })
    const outcome = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY, OWNER) },
      makeSeams(rate, queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(429)
    expect(outcome.body.code).toBe('RATE_LIMITED')
    expect(outcome.body.message).toBe(
      'Organization daily analysis limit reached. Try again tomorrow.',
    )
    expect(outcome.body.retryable).toBe(true)
    expect(outcome.body.retry_after).toBe(99)
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
    expect(store.usage).toEqual([])
  })

  test('rate exhaustion rejects with 429 before touching queue or store', async () => {
    setToken(SECRET)
    const rate = makeRate([OWNER])
    const queue = makeQueue()
    const store = makeStore({ memberships: [{ org_auth0_id: ORG }] })
    const outcome = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY, OWNER) },
      makeSeams(rate, queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(429)
    expect(outcome.body.code).toBe('RATE_LIMITED')
    expect(outcome.body.message).toBe('Analysis limit reached (5 per hour). Try again later.')
    expect(outcome.body.retry_after).toBeGreaterThan(0)
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
  })

  test('admitted job binds owner_ids to the attributed sub (jobAccess honored)', async () => {
    setToken(SECRET)
    const request = analyzeRequest(VALID_BODY, OWNER)
    const queue = makeQueue()
    const store = makeStore({ memberships: [{ org_auth0_id: ORG }] })
    const outcome = await admitAnalysis({ request }, makeSeams(makeRate(), queue, store))

    expect(outcome.ok).toBe(true)
    expect(verifyJobAccess(request, { owner_ids: queue.jobs[0].owner_ids ?? [] })).toEqual({
      ok: true,
      callerSub: OWNER,
    })
  })

  test('persists before enqueueing; usage trails admission', async () => {
    setToken(SECRET)
    const order: string[] = []
    const seams: AdmissionSeams = {
      rate: makeRate(),
      queue: {
        enqueue: async (job) => {
          order.push(`enqueue:${job.server_job_id}`)
        },
      },
      store: {
        memberships: async () => [{ org_auth0_id: ORG }],
        quota: async () => ({ allowed: true, retryAfterSec: 0 }),
        tier: async () => 'free' as const,
        persistStart: async (record) => {
          order.push(`persist:${record.serverJobId}`)
        },
        recordUsage: async () => {
          order.push('usage')
        },
      },
    }
    const outcome = await admitAnalysis({ request: analyzeRequest(VALID_BODY, OWNER) }, seams)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(order).toEqual([
      `persist:${outcome.serverJobId}`,
      `enqueue:${outcome.serverJobId}`,
      'usage',
    ])
  })

  test('usage is recorded against the primary org, falling back to the owner sub', async () => {
    setToken(SECRET)
    const queue = makeQueue()

    const withOrg = makeStore({ memberships: [{ org_auth0_id: ORG }] })
    const first = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY, OWNER) },
      makeSeams(makeRate(), queue, withOrg),
    )
    expect(first.ok).toBe(true)
    expect(withOrg.usage).toEqual([{ org: ORG, kind: 'analysis' }])

    const solo = makeStore({ memberships: [] })
    const second = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY, OWNER) },
      makeSeams(makeRate(), queue, solo),
    )
    expect(second.ok).toBe(true)
    expect(solo.usage).toEqual([{ org: OWNER, kind: 'analysis' }])
  })

  test('membership or tier outages degrade to owner scope and free priority', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore({ membershipsError: true, tierError: true })
    const outcome = await admitAnalysis(
      { request: analyzeRequest(VALID_BODY, OWNER) },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(true)
    expect(queue.jobs[0].priority).toBe(5)
    expect(queue.jobs[0].owner_ids).toEqual([OWNER])
    expect(store.usage).toEqual([{ org: OWNER, kind: 'analysis' }])
  })

  test('payload fields flow to queue and history record', async () => {
    setToken(SECRET)
    const sessionToken = '123e4567-e89b-12d3-a456-426614174000'
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      {
        request: analyzeRequest({
          session_token: sessionToken,
          player_index: 2,
          video_key: 'vk-1',
          angle: 'side',
        }),
      },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(true)
    expect(queue.jobs[0].session_token).toBe(sessionToken)
    expect(queue.jobs[0].player_index).toBe(2)
    expect(queue.jobs[0].video_key).toBe('vk-1')
    expect(queue.jobs[0].angle).toBe('side')
    const record = store.persisted[0] as {
      sessionToken: string | null
      playerIndex: number | null
      auth0Id: string | null
    }
    expect(record.sessionToken).toBe(sessionToken)
    expect(record.playerIndex).toBe(2)
    expect(record.auth0Id).toBeNull()
  })

  test('invalid session_token rejects with 400 without enqueueing', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      { request: analyzeRequest({ session_token: 'not-a-uuid', player_index: null }) },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(400)
    expect(outcome.body.code).toBe('INVALID_SESSION_TOKEN')
    expect(outcome.body.retryable).toBe(false)
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
  })

  test('invalid player_index rejects with 400 without enqueueing', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      { request: analyzeRequest({ session_token: null, player_index: 0 }) },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(400)
    expect(outcome.body.code).toBe('INVALID_PLAYER_INDEX')
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
  })

  test('malformed JSON rejects with 400 without enqueueing', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      { request: analyzeRequest('{oops', OWNER) },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(400)
    expect(outcome.body.code).toBe('INVALID_REQUEST')
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
  })

  test('roster scope admits with base priority 10 and coach+requester owners', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore({ tier: 'pro' })
    const outcome = await admitAnalysis(
      {
        request: analyzeRequest(VALID_BODY),
        body: { ...VALID_BODY },
        roster: {
          coachAuth0Id: 'auth0|roster-coach',
          requestedBy: 'auth0|roster-player',
          studentId: '123e4567-e89b-12d3-a456-426614174000',
        },
      },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(queue.jobs).toHaveLength(1)
    expect(queue.jobs[0].priority).toBe(15)
    expect(queue.jobs[0].owner_ids).toEqual(['auth0|roster-coach', 'auth0|roster-player'])
    const record = store.persisted[0] as {
      auth0Id: string | null
      requestedBy: string | null
      studentId: string | null
    }
    expect(record.auth0Id).toBe('auth0|roster-coach')
    expect(record.requestedBy).toBe('auth0|roster-player')
    expect(record.studentId).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(store.usage).toEqual([{ org: 'auth0|roster-coach', kind: 'analysis' }])
  })

  test('roster scope checks quota on the coach org and rejects with 429', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore({ quota: { allowed: false, retryAfterSec: 99 } })
    const outcome = await admitAnalysis(
      {
        request: analyzeRequest(VALID_BODY),
        roster: {
          coachAuth0Id: 'auth0|roster-coach',
          requestedBy: 'auth0|roster-player',
          studentId: null,
        },
      },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.status).toBe(429)
    expect(outcome.body.code).toBe('RATE_LIMITED')
    expect(outcome.body.retry_after).toBe(99)
    expect(queue.jobs).toEqual([])
    expect(store.persisted).toEqual([])
    expect(store.usage).toEqual([])
  })

  test('roster scope dedupes identical coach and requester owners', async () => {
    setToken(SECRET)
    const queue = makeQueue()
    const store = makeStore()
    const outcome = await admitAnalysis(
      {
        request: analyzeRequest(VALID_BODY),
        roster: {
          coachAuth0Id: 'auth0|roster-coach',
          requestedBy: 'auth0|roster-coach',
          studentId: null,
        },
      },
      makeSeams(makeRate(), queue, store),
    )

    expect(outcome.ok).toBe(true)
    expect(queue.jobs[0].owner_ids).toEqual(['auth0|roster-coach'])
    expect(queue.jobs[0].priority).toBe(10)
  })
})
