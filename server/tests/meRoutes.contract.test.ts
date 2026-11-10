import { describe, expect, test } from 'bun:test'
import meRoutes from '../src/routes/me'

const TOKEN = 'test-service-token'
const prevToken = process.env.SERVICE_TOKEN
process.env.SERVICE_TOKEN = TOKEN

const guarded = (path: string, init: RequestInit = {}) =>
  meRoutes.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        'x-service-token': TOKEN,
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
  )

describe('me routes contract (real app, identity boundary)', () => {
  test('protected /api/me endpoints require verified identity (403)', async () => {
    const cases: Array<[string, RequestInit]> = [
      ['/api/me/orgs', {}],
      ['/api/me/profile', {}],
      ['/api/me/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/api/me/attendance', {}],
      ['/api/me/schedule', {}],
      ['/api/me/performance', {}],
      ['/api/me/objectives', {}],
      ['/api/me/analyses', {}],
      ['/api/me/reports', {}],
      ['/api/me/reports/rep-1', {}],
      ['/api/me/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/api/me/invites/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/api/me/attribution/mint', {}],
    ]

    for (const [path, init] of cases) {
      const res = await guarded(path, init)
      expect(res.status).toBe(403)
      const body = (await res.json()) as any
      expect(body).toMatchObject({ code: 'FORBIDDEN', layer: 'server', retryable: false })
      expect(typeof body.message).toBe('string')
    }
  })

  test('requests without service token are rejected by guard', async () => {
    const res = await meRoutes.handle(
      new Request('http://localhost/api/me/profile', {
        headers: { 'x-verified-auth0-id': 'auth0|x' },
      }),
    )
    expect(res.status).toBe(403)
  })
})

process.on('exit', () => {
  if (prevToken === undefined) delete (process.env as any).SERVICE_TOKEN
  else process.env.SERVICE_TOKEN = prevToken
})