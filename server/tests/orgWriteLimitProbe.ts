// Org-write limiter probe: the REAL plugin + limiter against stub routes.
// Redis fails always, so every verdict comes from the in-memory fallback —
// no quota, no server. Prints the observed statuses as the last line.
// ORG_WRITE_RATE_LIMIT is read per call, so the budget is set here.

import { mock } from 'bun:test'
import { Elysia } from 'elysia'

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    rateLimitIncrement: async () => {
      throw new Error('redis down in this probe')
    },
  },
}))

mock.module('../src/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''
process.env.ORG_WRITE_RATE_LIMIT = '3'

const { orgWriteRateLimit } = await import('../src/lib/ratelimit')

const app = new Elysia()
  .use(orgWriteRateLimit)
  .post('/api/org/:auth0Id/students', () => ({ ok: true }))
  .get('/api/org/:auth0Id/students', () => ({ ok: true }))

const call = (method: string, verified: string | null) =>
  app.handle(
    new Request('http://localhost/api/org/auth0|x/students', {
      method,
      headers: verified ? { 'x-verified-auth0-id': verified } : {},
    }),
  )

const statuses: number[] = []
let retryAfter: unknown
let code: unknown
// Budget of 3: first three writes pass, the fourth is refused…
for (let i = 0; i < 4; i += 1) {
  const res = await call('POST', 'auth0|writer-a')
  statuses.push(res.status)
  if (i === 3) {
    const body = (await res.json()) as { code?: unknown; retry_after?: unknown }
    code = body.code
    retryAfter = body.retry_after
  }
}
// …while reads never consume budget and another caller starts fresh.
for (let i = 0; i < 5; i += 1) {
  statuses.push((await call('GET', 'auth0|writer-a')).status)
}
statuses.push((await call('POST', 'auth0|writer-b')).status)

console.log(JSON.stringify({ statuses, code, retryAfter }))
