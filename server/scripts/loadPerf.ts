// HTTP load probe against a LOCAL server (never live). Measures p50/p95/p99
// per endpoint with service headers. Run:
//   PERF_BASE=http://localhost:8000 PERF_SERVICE_TOKEN=x PERF_ORG='auth0|perf-org' \
//   bun scripts/loadPerf.ts

const BASE = (process.env.PERF_BASE ?? 'http://localhost:8000').replace(/\/$/, '')
const TOKEN = process.env.PERF_SERVICE_TOKEN ?? ''
const ORG = process.env.PERF_ORG ?? 'auth0|perf-org'
if (!TOKEN) {
  console.error('Refusing to run: set PERF_SERVICE_TOKEN.')
  process.exit(1)
}

const headers = {
  'x-service-token': TOKEN,
  'x-verified-auth0-id': ORG,
}

const endpoints: Array<[string, string]> = [
  ['roster', `/api/org/${encodeURIComponent(ORG)}/students`],
  ['attendance', `/api/org/${encodeURIComponent(ORG)}/attendance`],
  ['reports', `/api/org/${encodeURIComponent(ORG)}/reports`],
  ['history', `/api/auth/user/${encodeURIComponent(ORG)}/analyses?limit=20`],
  ['trends', `/api/auth/user/${encodeURIComponent(ORG)}/findings/trends`],
  ['overview', `/api/org/${encodeURIComponent(ORG)}/overview`],
]

const N = Number(process.env.PERF_N ?? 50)

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

const out: Record<string, { n: number; p50: number; p95: number; p99: number; errors: number }> = {}

for (const [name, path] of endpoints) {
  const times: number[] = []
  let errors = 0
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    try {
      const res = await fetch(`${BASE}${path}`, { headers })
      await res.text()
      if (!res.ok) errors += 1
      times.push(performance.now() - t0)
    } catch {
      errors += 1
    }
  }
  times.sort((a, b) => a - b)
  out[name] = {
    n: N,
    p50: Math.round(pct(times, 50)),
    p95: Math.round(pct(times, 95)),
    p99: Math.round(pct(times, 99)),
    errors,
  }
}
console.log(JSON.stringify({ base: BASE, ...out }, null, 1))
