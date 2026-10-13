import { describe, expect, mock, test } from 'bun:test'

import { withUserJob } from '../src/lib/userJob'
import type { Caller } from '../src/lib/caller'

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
const set = (): { status?: number | string } => ({})

describe('withUserJob', () => {
  test('missing params short-circuit to 400 without touching the guard', async () => {
    const fn = mock(async () => ({ status: 200, body: {} }))
    const box = set()
    const res = await withUserJob(
      request(),
      box,
      { auth0Id: OWNER, resourceId: undefined, permission: 'denied' },
      fn,
      { resolveCaller: stubResolveCaller(callerWith(OWNER, false)) },
    )
    expect(box.status).toBe(400)
    expect(res).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fn).not.toHaveBeenCalled()
  })

  test('unverified caller gets 403 and the handler never runs', async () => {
    const fn = mock(async () => ({ status: 200, body: {} }))
    const box = set()
    const res = await withUserJob(
      request(),
      box,
      { auth0Id: OWNER, resourceId: 'job-1', permission: 'denied' },
      fn,
      { resolveCaller: stubResolveCaller(callerWith(null, false)) },
    )
    expect(box.status).toBe(403)
    expect(res).toMatchObject({ code: 'FORBIDDEN' })
    expect(fn).not.toHaveBeenCalled()
  })

  test('member without the permission gets the route denied message', async () => {
    const fn = mock(async () => ({ status: 200, body: {} }))
    const box = set()
    const res = await withUserJob(
      request(),
      box,
      {
        auth0Id: OWNER,
        resourceId: 'f1',
        permission: 'Finding review requires the finding.review permission',
      },
      fn,
      { resolveCaller: stubResolveCaller(callerWith(MEMBER, false)) },
    )
    expect(box.status).toBe(403)
    expect(res).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Finding review requires the finding.review permission',
    })
    expect(fn).not.toHaveBeenCalled()
  })

  test('owner self-passes and the handler status/body flow through', async () => {
    const fn = mock(async () => ({ status: 201, body: { clip: { id: 'c1' } } }))
    const box = set()
    const res = await withUserJob(
      request(),
      box,
      {
        auth0Id: OWNER,
        resourceId: 'job-1',
        permission: 'Clip creation requires the finding.review permission',
      },
      fn,
      { resolveCaller: stubResolveCaller(callerWith(OWNER, false)) },
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0]?.[0]).toMatchObject({ verified: OWNER })
    expect(box.status).toBe(201)
    expect(res).toEqual({ clip: { id: 'c1' } })
  })

  test('handler error results map to status/body without an audit write', async () => {
    const fn = mock(async () => ({
      status: 404,
      body: { code: 'NOT_FOUND' as const, message: 'Clip not found', retryable: false as const },
    }))
    const box = set()
    const res = await withUserJob(
      request(),
      box,
      {
        auth0Id: OWNER,
        resourceId: 'c9',
        jobId: 'job-1',
        permission: 'Clip deletion requires the finding.review permission',
      },
      fn,
      { resolveCaller: stubResolveCaller(callerWith(OWNER, false)) },
    )
    expect(box.status).toBe(404)
    expect(res).toMatchObject({ code: 'NOT_FOUND' })
  })
})
