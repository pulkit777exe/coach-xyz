import { describe, expect, mock, test } from 'bun:test'

import { resolveJobStatus, type StatusSeams } from '../src/lib/jobStatus'
import type { ServerJob } from '../src/lib/jobs'
import type { DashboardAnalysis } from '../src/lib/analyses'

const request = (): Request => new Request('http://localhost/api/job-status/srv-1')

const job = {
  server_job_id: 'srv-1',
  engine_job_id: 'eng-1',
  session_token: 'tok',
  player_index: 1,
  model: 'm',
  owner_ids: [],
} as unknown as ServerJob

const persisted = {
  server_job_id: 'srv-1',
  auth0_id: 'auth0|coach-1',
  complete: true,
  stage: 5,
  stage_name: 'Complete',
  progress: 100,
  summary_json: { form_score: 8 },
  video_ready: true,
  error_message: null,
  error_code: null,
} as unknown as DashboardAnalysis

const accessOk = { ok: true as const, callerSub: 'auth0|coach-1' }

const baseSeams = (): StatusSeams & {
  persist: ReturnType<typeof mock>
} => ({
  getJob: async () => job,
  getPersisted: async () => null,
  checkAccess: (() => accessOk) as StatusSeams['checkAccess'],
  pollEngine: async () => ({ status: 'not_found' }) as never,
  persist: mock(async () => undefined),
  ownerOf: async () => ({ auth0_id: 'auth0|coach-1', requested_by: null, student_id: null }),
  medical: async () => true,
  redact: (s: unknown) => s,
  requestId: () => 'r1',
})

describe('resolveJobStatus', () => {
  test('missing jobs with no persisted row map to 404', async () => {
    const outcome = await resolveJobStatus('missing', request(), {
      ...baseSeams(),
      getJob: async () => null,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.status).toBe(404)
      expect(outcome.body).toMatchObject({ code: 'JOB_NOT_FOUND' })
    }
  })

  test('expired Redis rows fall back to the persisted analysis', async () => {
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...baseSeams(),
      getJob: async () => null,
      getPersisted: async () => persisted,
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.status).toBe(200)
      expect(outcome.body).toMatchObject({ state: 'completed', complete: true })
      expect(outcome.body.summary).toEqual({ form_score: 8 })
    }
  })

  test('persisted rows denied by access map to the access verdict', async () => {
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...baseSeams(),
      getJob: async () => null,
      getPersisted: async () => persisted,
      checkAccess: (() => ({
        ok: false as const,
        status: 403,
        body: { code: 'FORBIDDEN' },
      })) as StatusSeams['checkAccess'],
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.status).toBe(403)
  })

  test('persisted summaries redact without medical access', async () => {
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...baseSeams(),
      getJob: async () => null,
      getPersisted: async () => persisted,
      medical: async () => false,
      redact: () => ({ redacted: true }),
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.body.summary).toEqual({ redacted: true })
  })

  test('transient engine errors return retrying state without persisting', async () => {
    const seams = baseSeams()
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...seams,
      pollEngine: (async () => ({ status: 'transient_error' })) as StatusSeams['pollEngine'],
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.body).toMatchObject({ state: 'scanning', stage_name: 'Retrying...' })
    }
    expect(seams.persist).not.toHaveBeenCalled()
  })

  test('engine not_found persists a failed status and returns failed', async () => {
    const seams = baseSeams()
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...seams,
      pollEngine: (async () => ({ status: 'not_found' })) as StatusSeams['pollEngine'],
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.body).toMatchObject({ state: 'failed', error_code: 'JOB_NOT_FOUND' })
    }
    expect(seams.persist).toHaveBeenCalledTimes(1)
    const record = seams.persist.mock.calls[0]?.[0] as { status: { error_code: string } }
    expect(record.status.error_code).toBe('JOB_NOT_FOUND')
  })

  test('engine success persists and redacts without medical access', async () => {
    const seams = baseSeams()
    const engineStatus = {
      state: 'analyzing',
      stage: 3,
      stage_name: 'Analyzing',
      progress: 50,
      complete: false,
      summary: { form_score: 7 },
      video_ready: false,
      error: null,
      error_code: null,
      retryable: true,
    }
    const outcome = await resolveJobStatus('srv-1', request(), {
      ...seams,
      pollEngine: (async () => ({ status: 'found', data: engineStatus })) as never,
      medical: async () => false,
      redact: () => ({ redacted: true }),
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.body).toMatchObject({ state: 'analyzing', progress: 50 })
      expect(outcome.body.summary).toEqual({ redacted: true })
    }
    expect(seams.persist).toHaveBeenCalledTimes(1)
  })
})

describe('checkJobStatusRateLimit', () => {
  test('allows normal polling and rejects floods', async () => {
    const { __setRedisForTests } = await import('../src/lib/ratelimit')
    const { checkJobStatusRateLimit } = await import('../src/routes/status')
    __setRedisForTests({
      rateLimitIncrement: async () => {
        throw new Error('redis_unavailable')
      },
    })
    try {
      const req = () => new Request('http://localhost/api/job-status/srv-1')
      // Default cap is 120/min: normal polls pass, a flood is rejected.
      for (let i = 0; i < 120; i++) {
        expect(await checkJobStatusRateLimit(req())).toBe(true)
      }
      expect(await checkJobStatusRateLimit(req())).toBe(false)
    } finally {
      __setRedisForTests(null)
    }
  })
})
