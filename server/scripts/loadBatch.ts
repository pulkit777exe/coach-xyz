// Batch attendance load probe: N entries in one request, timed end to end.
// LOCAL ONLY.

const BASE = (process.env.PERF_BASE ?? 'http://localhost:8000').replace(/\/$/, '')
const TOKEN = process.env.PERF_SERVICE_TOKEN ?? ''
const ORG = process.env.PERF_ORG ?? 'auth0|perf-org'
const STUDENTS = (process.env.PERF_STUDENTS ?? '').split(',').filter(Boolean)
const N = Number(process.env.PERF_N ?? 200)
if (!TOKEN || STUDENTS.length === 0) {
  console.error('Refusing to run: set PERF_SERVICE_TOKEN and PERF_STUDENTS (csv).')
  process.exit(1)
}

const entries = Array.from({ length: N }, (_, i) => ({
  student_id: STUDENTS[i % STUDENTS.length],
  session_date: `2026-08-${String(1 + (i % 28)).padStart(2, '0')}`,
  status: 'present',
}))

const reps = 5
const times: number[] = []
for (let r = 0; r < reps; r++) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}/api/org/${encodeURIComponent(ORG)}/attendance/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-service-token': TOKEN,
      'x-verified-auth0-id': ORG,
    },
    body: JSON.stringify({ entries }),
  })
  const body = (await res.json().catch(() => null)) as { count?: number } | null
  times.push(performance.now() - t0)
  if (!res.ok) {
    console.error(`unexpected: status=${res.status} count=${body?.count}`)
    process.exit(1)
  }
}
times.sort((a, b) => a - b)
console.log(JSON.stringify({ n: N, reps, ms: times.map(Math.round) }))
