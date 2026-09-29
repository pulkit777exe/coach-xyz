// Deep-health probe: real healthRoute against stubbed backends. One scenario
// per process (HEALTH_DEEP_CASE); prints the { status, body } as the last
// line. The engine is real HTTP: either a local Bun.serve (up) or a refused
// port (down). Mocks: redis (import-time connector), queue (workers),
// historyStore (pg), logger (noise).

import { mock } from 'bun:test'

const scenario = process.env.HEALTH_DEEP_CASE ?? 'all-up'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis:
    scenario === 'redis-down'
      ? {
          ping: async () => {
            throw new Error('connection refused')
          },
        }
      : {
          ping: async () => 'PONG',
        },
}))

mock.module('../src/lib/queue', () => ({
  analysisQueue: null,
}))

mock.module('../src/lib/historyStore', () => ({
  withHistoryStore: async (fn: (db: unknown) => unknown) => {
    if (scenario === 'db-down') return null
    const db = Object.assign(async () => [{ ok: 1 }], {
      unsafe: (sql: unknown) => sql,
    })
    return fn(db)
  },
  withHistoryStoreOrThrow: async () => {
    throw new Error('unused in this probe')
  },
  historyStoreEnabled: () => scenario !== 'db-down',
  orDisabledDefault: <T>(v: T | null, f: T) => (v ?? f),
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

let engine: { stop: () => void } | null = null
if (scenario !== 'engine-down') {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === '/health'
        ? new Response('{"status":"ok"}')
        : new Response('not found', { status: 404 }),
  })
  engine = server
  process.env.ENGINE_URL = `http://127.0.0.1:${server.port}`
} else {
  // Nothing listens here: connection refused, fast.
  process.env.ENGINE_URL = 'http://127.0.0.1:1'
}

const { healthRoute } = await import('../src/routes/health')
const res = await healthRoute.handle(new Request('http://localhost/health/deep'))
const body = (await res.json()) as unknown
console.log(JSON.stringify({ status: res.status, body }))
engine?.stop()
