import { describe, expect, test } from 'bun:test'

import { authorizeJob, failEngineJobForServerJob } from '../src/lib/jobGuard'
import type { Caller } from '../src/lib/caller'
import type { ServerJob } from '../src/lib/jobs'

const OWNER = 'auth0|owner-1'
const MEMBER = 'auth0|member-1'

const callerWith = (verified: string | null, canReview: boolean): Caller => ({
  verified,
  role: verified === OWNER ? 'owner' : verified ? 'coach' : null,
  teamIds: [],
  studentScope: { all: true },
  can: () => canReview,
  canAccessTeam: () => true,
})

const stubResolveCaller =
  (caller: Caller) =>
  async (_auth0Id: string, _request: Request): Promise<Caller> =>
    caller

const request = (): Request => new Request('http://localhost/api/auth/user/x/findings/y')

describe('authorizeJob', () => {
  test('owner self-passes without the finding.review permission', async () => {
    const res = await authorizeJob(OWNER, request(), 'denied', {
      resolveCaller: stubResolveCaller(callerWith(OWNER, false)),
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.caller.verified).toBe(OWNER)
  })

  test('member with finding.review passes', async () => {
    const res = await authorizeJob(OWNER, request(), 'denied', {
      resolveCaller: stubResolveCaller(callerWith(MEMBER, true)),
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.caller.verified).toBe(MEMBER)
  })

  test('member without finding.review gets the route denied message', async () => {
    const res = await authorizeJob(
      OWNER,
      request(),
      'Clip creation requires the finding.review permission',
      {
        resolveCaller: stubResolveCaller(callerWith(MEMBER, false)),
      },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Clip creation requires the finding.review permission',
        layer: 'server',
        retryable: false,
      })
    }
  })

  test('missing verified identity is rejected', async () => {
    const res = await authorizeJob(OWNER, request(), 'denied', {
      resolveCaller: stubResolveCaller(callerWith(null, false)),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Missing verified identity',
      })
    }
  })
})

describe('failEngineJobForServerJob', () => {
  const serverJob: ServerJob = {
    server_job_id: 'srv-1',
    engine_job_id: 'eng-1',
    session_token: null,
    player_index: null,
    model: 'm',
    created_at: 0,
  }

  test('marks the engine job ANALYSIS_CANCELLED for a known server job', async () => {
    const calls: unknown[][] = []
    await failEngineJobForServerJob('srv-1', 'Analysis cancelled.', {
      getJob: async () => serverJob,
      markEngineJobFailed: async (
        engineJobId: string,
        message: string,
        code: string,
        retryable: boolean,
        requestId?: string | null,
      ) => {
        calls.push([engineJobId, message, code, retryable, requestId])
      },
    })
    expect(calls).toEqual([['eng-1', 'Analysis cancelled.', 'ANALYSIS_CANCELLED', false, 'srv-1']])
  })

  test('no-ops when the server job is already gone', async () => {
    const calls: unknown[][] = []
    await failEngineJobForServerJob('gone', 'Analysis deleted.', {
      getJob: async () => null,
      markEngineJobFailed: async (
        engineJobId: string,
        message: string,
        code: string,
        retryable: boolean,
        requestId?: string | null,
      ) => {
        calls.push([engineJobId, message, code, retryable, requestId])
      },
    })
    expect(calls).toEqual([])
  })
})
