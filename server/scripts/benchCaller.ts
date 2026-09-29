// Caller-memo benchmark: N resolveCaller calls sharing one Request (one HTTP
// request's resolutions) vs N distinct Requests. LOCAL ONLY.

import { resolveCaller } from '../src/lib/caller'

const ORG = 'auth0|perf-org'
const COACH = 'auth0|perf-coach'
const N = 50

const req = (id: string): Request =>
  new Request('http://localhost/api/org/x/teams', {
    headers: { 'x-verified-auth0-id': COACH, 'x-request-nonce': id },
  })

// Warmup.
await resolveCaller(ORG, req('warm'))

// Shared request: one HTTP request resolving twice (capability + scope).
{
  const r = req('shared')
  const t0 = performance.now()
  for (let i = 0; i < N; i++) await resolveCaller(ORG, r)
  console.log(JSON.stringify({ mode: 'shared-request', n: N, ms: Math.round(performance.now() - t0) }))
}

// Distinct requests: N separate HTTP requests (no sharing possible).
{
  const t0 = performance.now()
  for (let i = 0; i < N; i++) await resolveCaller(ORG, req(`r${i}`))
  console.log(JSON.stringify({ mode: 'distinct-requests', n: N, ms: Math.round(performance.now() - t0) }))
}
