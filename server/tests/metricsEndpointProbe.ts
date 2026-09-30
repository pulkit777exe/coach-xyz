// Metrics endpoint probe: real composed app, stubbed backends. Hits one
// guard-exempt route plus a 404, then checks /health/metrics recorded the
// pattern key, folded the 404, skipped the shallow probe, and needed no
// credentials. Prints the result as the last line.

import { mock } from 'bun:test'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))

mock.module('../src/lib/historyStore', () => ({
  withHistoryStore: async () => null,
  withHistoryStoreOrThrow: async () => {
    throw new Error('unused in this probe')
  },
  orDisabledDefault: <T>(v: T | null, f: T) => (v ?? f),
  historyStoreEnabled: () => false,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

process.env.SERVICE_TOKEN = 'metrics-token'
process.env.DATABASE_URL = ''
process.env.ENGINE_URL = ''

const { buildApp } = await import('../src/app')
const { resetMetricsForTests } = await import('../src/lib/metrics')
resetMetricsForTests()

const app = buildApp()
const get = (path: string, headers?: Record<string, string>) =>
  app.handle(new Request(`http://localhost${path}`, { headers }))

await get('/api/sports/basketball/positions')
await get('/definitely-not-a-route')
// The shallow probe is poll traffic: recorded nowhere (same skip rule as
// the access log). /health/* siblings record normally.
await get('/health')
// onAfterResponse runs after handle() resolves, so poll until the counters
// land (bounded: the hooks fire on setImmediate, not on a timer).
let metricsRes = await get('/health/metrics')
let metrics = (await metricsRes.json()) as {
  routes: Record<string, { count: number }>
}
for (let i = 0; i < 40 && !metrics.routes['GET unmatched']; i += 1) {
  await new Promise((r) => setTimeout(r, 50))
  metricsRes = await get('/health/metrics')
  metrics = (await metricsRes.json()) as {
    routes: Record<string, { count: number }>
  }
}

console.log(
  JSON.stringify({
    status: metricsRes.status,
    requestId: metricsRes.headers.get('x-request-id'),
    positions: metrics.routes['GET /api/sports/:sport/positions']?.count ?? 0,
    unmatched: metrics.routes['GET unmatched']?.count ?? 0,
    shallowHealthKeys: Object.keys(metrics.routes).filter((k) => k === 'GET /health'),
  }),
)
