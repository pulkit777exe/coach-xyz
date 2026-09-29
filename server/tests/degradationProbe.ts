// Degradation probe: EVERYTHING down at once — no DATABASE_URL (store
// disabled, real module), Redis failing (memory fallback), engine refusing.
// Drives the real composed app and prints per-route { status, code } as the
// last line. The contract pinned here: fail-open where defaults exist
// (settings/consent read 200 with defaults), fail-closed AND observable
// (shaped 500 envelope, never a leak or empty body) where the store is the
// only source of truth, engine-dependent statics degrade to [], and
// /health/deep reports degraded with database.ok false.
// Mocks: redis (import-time connector), queue (workers), logger (noise).

import { mock } from 'bun:test'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    ping: async () => {
      throw new Error('redis down in this probe')
    },
    rateLimitIncrement: async () => {
      throw new Error('redis down in this probe')
    },
  },
}))

mock.module('../src/lib/queue', () => ({
  enqueueAnalysis: async () => undefined,
  enqueueAiReport: async () => 'ai-job-1',
  analysisQueue: null,
  aiReportQueue: null,
  worker: null,
  aiReportWorker: null,
  queueEvents: null,
  notificationDigestQueue: null,
  notificationDigestWorker: null,
  onQueueInfrastructureReady: () => undefined,
  classifyFailure: () => ({ retryable: false }) as never,
  buildFailedAnalysisStatus: () => ({}) as never,
  isFatalRedisError: () => false,
  startQueueInfrastructure: () => undefined,
  stopQueueInfrastructure: async () => undefined,
}))

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

process.env.SERVICE_TOKEN = 'degraded-token'
process.env.DATABASE_URL = ''
process.env.ENGINE_URL = 'http://127.0.0.1:1'

const { buildApp } = await import('../src/app')
const app = buildApp()

const ORG = 'auth0|degraded-org'
const svc = {
  'x-service-token': 'degraded-token',
  'x-verified-auth0-id': ORG,
  'content-type': 'application/json',
}

type Check = { route: string; status: number; code?: unknown }

const check = async (
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<Check> => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  let code: unknown
  try {
    code = ((await res.json()) as { code?: unknown }).code
  } catch {
    code = '<non-json>'
  }
  return { route: `${method} ${path}`, status: res.status, code }
}

const checks: Check[] = []
// Fail-open reads (defaults exist because the store can be absent).
checks.push(await check('GET', '/api/me/consent', { ...svc, 'x-verified-auth0-id': 'auth0|coach' }))
checks.push(
  await check('GET', '/api/me/notification-preferences', {
    ...svc,
    'x-verified-auth0-id': 'auth0|coach',
  }),
)
// Fail-closed: the roster lives only in the store (shaped 500, observed).
checks.push(await check('GET', `/api/org/${encodeURIComponent(ORG)}/students`, svc))
checks.push(
  await check('POST', `/api/org/${encodeURIComponent(ORG)}/students`, svc, {
    full_name: 'No Store Rookie',
  }),
)
// Engine-dependent statics degrade to empty.
checks.push(await check('GET', '/api/sports/basketball/positions'))
// Unknown paths keep Elysia's NOT_FOUND text (shaper passes 404 through).
{
  const res = await app.handle(new Request('http://localhost/no-such-path'))
  checks.push({
    route: 'GET /no-such-path',
    status: res.status,
    code: (await res.text()).slice(0, 20),
  })
}
// Ops view reports the outage.
{
  const res = await app.handle(new Request('http://localhost/health/deep'))
  const body = (await res.json()) as {
    status?: unknown
    checks?: { database?: { ok?: unknown; enabled?: unknown }; redis?: { ok?: unknown } }
  }
  checks.push({ route: 'GET /health/deep', status: res.status, code: body.status })
  checks.push({
    route: 'GET /health/deep#checks',
    status: res.status,
    code: JSON.stringify({
      database: body.checks?.database ?? null,
      redis: body.checks?.redis ?? null,
    }),
  })
}

console.log(JSON.stringify({ checks }))
