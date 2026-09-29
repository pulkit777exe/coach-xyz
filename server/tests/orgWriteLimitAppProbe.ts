// App-ordering probe: the limiter must be composed FIRST in buildApp — a
// global hook fires only for routes mounted after its .use(), so appending
// it at the end silently covers nothing (caught live: 6 writes at budget
// 5 all passed). Real plugin + limiter (memory fallback), minimal store
// stubs: allowed requests reach the handler (non-429), the third write
// 429s, reads pass through. Prints statuses as the last line.

import { mock } from 'bun:test'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    rateLimitIncrement: async () => {
      throw new Error('redis down in this probe')
    },
  },
}))

mock.module('../src/lib/historyStore', () => ({
  withHistoryStore: async () => null,
  withHistoryStoreOrThrow: async () => {
    throw new Error('no store in this probe')
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

process.env.SERVICE_TOKEN = 'order-token'
process.env.DATABASE_URL = ''
process.env.ORG_WRITE_RATE_LIMIT = '2'

const { buildApp } = await import('../src/app')
const app = buildApp()

const h = {
  'content-type': 'application/json',
  'x-service-token': 'order-token',
  'x-verified-auth0-id': 'auth0|order-org',
}
const statuses: number[] = []
for (let i = 0; i < 3; i += 1) {
  const res = await app.handle(
    new Request('http://localhost/api/org/auth0|order-org/students', {
      method: 'POST',
      headers: h,
      body: '{}',
    }),
  )
  statuses.push(res.status)
  await res.text()
}
const read = await app.handle(
  new Request('http://localhost/api/org/auth0|order-org/students', { headers: h }),
)
statuses.push(read.status)
await read.text()

console.log(JSON.stringify({ statuses }))
