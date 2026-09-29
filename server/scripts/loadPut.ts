// PUT-focused load probe: resolves the caller twice per request (capability
// + scope), so the per-request caller memo shows up here. Run against local:
//   PERF_BASE=... PERF_SERVICE_TOKEN=x PERF_ORG=... PERF_COACH=... PERF_STUDENT=... \
//   bun scripts/loadPut.ts

const BASE = (process.env.PERF_BASE ?? 'http://localhost:8000').replace(/\/$/, '')
const TOKEN = process.env.PERF_SERVICE_TOKEN ?? ''
const ORG = process.env.PERF_ORG ?? 'auth0|perf-org'
const COACH = process.env.PERF_COACH ?? 'auth0|perf-coach'
const STUDENT = process.env.PERF_STUDENT ?? ''
if (!TOKEN || !STUDENT) {
  console.error('Refusing to run: set PERF_SERVICE_TOKEN and PERF_STUDENT.')
  process.exit(1)
}

const N = Number(process.env.PERF_N ?? 50)
const times: number[] = []
let errors = 0
for (let i = 0; i < N; i++) {
  const t0 = performance.now()
  try {
    const res = await fetch(
      `${BASE}/api/org/${encodeURIComponent(ORG)}/students/${STUDENT}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-service-token': TOKEN,
          'x-verified-auth0-id': COACH,
        },
        body: JSON.stringify({ notes: `load-${i}` }),
      },
    )
    await res.text()
    if (!res.ok) errors += 1
    times.push(performance.now() - t0)
  } catch {
    errors += 1
  }
}
times.sort((a, b) => a - b)
const pct = (p: number): number => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))]
console.log(JSON.stringify({ n: N, p50: Math.round(pct(50)), p95: Math.round(pct(95)), p99: Math.round(pct(99)), errors }))
