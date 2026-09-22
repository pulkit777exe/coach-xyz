import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { aiReportsRoute, validateAiReportBody } from '../src/routes/aiReports'
import type { AiReportJob } from '../src/lib/aiReportData'
import type { ReportRecord } from '../src/lib/orgData'

const TEST_SERVICE_TOKEN = 'test-service-token'
const headersFor = (auth0Id: string) => ({
  'x-service-token': TEST_SERVICE_TOKEN,
  'x-verified-auth0-id': auth0Id,
})

// ── Pure validation (no server, no deps) ────────────────────────────────────

describe('validateAiReportBody', () => {
  test('accepts a valid request', () => {
    const result = validateAiReportBody({ report_type: 'progress' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.report_type).toBe('progress')
  })

  test('accepts optional period/student/title fields', () => {
    const result = validateAiReportBody({
      report_type: 'performance',
      student_id: 's1',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      title: 'Summer review',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.student_id).toBe('s1')
      expect(result.value.period_start).toBe('2026-08-01')
      expect(result.value.title).toBe('Summer review')
    }
  })

  test('rejects unknown report_type', () => {
    const result = validateAiReportBody({ report_type: 'nonsense' })
    expect(result.ok).toBe(false)
  })

  test('rejects missing report_type', () => {
    const result = validateAiReportBody({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_REQUEST')
  })

  test('rejects malformed dates', () => {
    for (const key of ['period_start', 'period_end']) {
      const result = validateAiReportBody({
        report_type: 'monthly',
        [key]: '08/01/2026',
      })
      expect(result.ok).toBe(false)
    }
  })

  test('rejects non-object bodies', () => {
    expect(validateAiReportBody('progress').ok).toBe(false)
    expect(validateAiReportBody(null).ok).toBe(false)
  })
})

// ── Route tests (injected deps, no DB/Redis) ────────────────────────────────

const fakeJob = (overrides: Partial<AiReportJob> = {}): AiReportJob => ({
  report_job_id: 'job-1',
  auth0_id: 'auth-coach-1',
  status: 'queued',
  report_id: null,
  error: null,
  progress: 0,
  created_at: 1,
  updated_at: 1,
  ...overrides,
})

const fakeReport: ReportRecord & { full_name: string | null } = {
  id: 'report-1',
  auth0_id: 'auth-coach-1',
  student_id: null,
  report_type: 'progress',
  title: 'Avery — Progress Report',
  period_start: null,
  period_end: null,
  content_json: { narrative: 'Good month.', raw_report: '{}' },
  created_at: '2026-09-17T00:00:00.000Z',
  updated_at: '2026-09-17T00:00:00.000Z',
  full_name: null,
}

function makeApp(overrides: {
  enqueue?: (payload: unknown) => Promise<string | null>
  getJob?: (id: string) => Promise<AiReportJob | null>
  getReportById?: (auth0Id: string, id: string) => Promise<typeof fakeReport | null>
  buildContext?: (auth0Id: string, opts?: unknown) => Promise<Record<string, unknown>>
}) {
  return new Elysia().use(
    aiReportsRoute({
      enqueue: overrides.enqueue as never,
      getJob: overrides.getJob,
      getReportById: overrides.getReportById ? (overrides.getReportById as never) : undefined,
      buildContext: overrides.buildContext as never,
    }),
  )
}

const defaultContext: Record<string, unknown> = {
  generated_at: '2026-09-17',
  student: { full_name: 'Avery Chen', sport: 'tennis' },
  period: { start: null, end: null },
  attendance: { total_records: 0 },
  performance: {},
  analyses: [],
  summary: 'No data',
  org: null,
}

describe('POST /api/org/:auth0Id/reports/ai', () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
    // A live Redis (auto-loaded server/.env) persists the per-org ai-report
    // rate-limit counter across suite runs within the hour, which flakes the
    // repeated POSTs in this file at the default 10/hr. Pin a high limit.
    process.env.AI_REPORT_RATE_LIMIT = '1000'
  })
  afterEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
    process.env.AI_REPORT_RATE_LIMIT = '1000'
  })

  test('enqueues a report and returns 201 with report_job_id', async () => {
    let capturedPayload: unknown = null
    const app = makeApp({
      enqueue: async (payload) => {
        capturedPayload = payload
        return 'job-1'
      },
      buildContext: async () => defaultContext,
    })

    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersFor('auth-coach-1'),
        },
        body: JSON.stringify({ report_type: 'progress' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.report_job_id).toBe('job-1')
    expect(body.status).toBe('queued')

    const payload = capturedPayload as {
      title?: string
      sport?: string
      student_name?: string
      report_context?: unknown
    }
    expect(payload.title).toBe('Avery Chen — Progress Report')
    expect(payload.sport).toBe('tennis')
    expect(payload.student_name).toBe('Avery Chen')
    expect(payload.report_context).toBe(defaultContext)
  })

  test('passes student/period into the context builder', async () => {
    let captured: unknown = null
    const app = makeApp({
      buildContext: async (_auth0Id, opts) => {
        captured = opts
        return defaultContext
      },
      enqueue: async () => 'job-1',
    })

    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersFor('auth-coach-1'),
        },
        body: JSON.stringify({
          report_type: 'performance',
          student_id: 's1',
          period_start: '2026-08-01',
          period_end: '2026-08-31',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const opts = captured as {
      student_id?: string
      from?: string
      to?: string
      report_type?: string
    }
    expect(opts.student_id).toBe('s1')
    expect(opts.from).toBe('2026-08-01')
    expect(opts.to).toBe('2026-08-31')
    expect(opts.report_type).toBe('performance')
  })

  test('returns 400 for invalid report_type', async () => {
    const app = makeApp({})
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersFor('auth-coach-1'),
        },
        body: JSON.stringify({ report_type: 'bogus' }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_REQUEST')
  })

  test('returns 503 QUEUE_UNAVAILABLE when no worker is configured', async () => {
    const app = makeApp({
      enqueue: async () => null,
      buildContext: async () => defaultContext,
    })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersFor('auth-coach-1'),
        },
        body: JSON.stringify({ report_type: 'monthly' }),
      }),
    )
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('QUEUE_UNAVAILABLE')
  })

  test('rejects requests without valid service identity', async () => {
    const app = makeApp({
      enqueue: async () => 'job-1',
      buildContext: async () => defaultContext,
    })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_type: 'progress' }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/org/:auth0Id/reports/ai/:reportJobId', () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
  })
  afterEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
  })

  test('returns the report when done', async () => {
    const app = makeApp({
      getJob: async () => fakeJob({ status: 'done', report_id: 'report-1' }),
      getReportById: async () => fakeReport,
    })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai/job-1', {
        headers: headersFor('auth-coach-1'),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('done')
    expect(body.report.id).toBe('report-1')
  })

  test('returns no report while running', async () => {
    const app = makeApp({
      getJob: async () => fakeJob({ status: 'running', progress: 45 }),
    })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai/job-1', {
        headers: headersFor('auth-coach-1'),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
    expect(body.report).toBeNull()
  })

  test('exposes failure status with error', async () => {
    const app = makeApp({
      getJob: async () =>
        fakeJob({
          status: 'failed',
          error: 'GEMINI_QUOTA_EXCEEDED: out of quota',
        }),
    })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai/job-1', {
        headers: headersFor('auth-coach-1'),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('failed')
    expect(body.report).toBeNull()
  })

  test('404s for unknown jobs', async () => {
    const app = makeApp({ getJob: async () => null })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-1/reports/ai/nope', {
        headers: headersFor('auth-coach-1'),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('404s for jobs owned by another org', async () => {
    const app = makeApp({ getJob: async () => fakeJob() })
    const res = await app.handle(
      new Request('http://localhost/api/org/auth-coach-2/reports/ai/job-1', {
        headers: headersFor('auth-coach-2'),
      }),
    )
    expect(res.status).toBe(404)
  })
})
