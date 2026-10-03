// ── /api/me/attendance + /api/me/performance bounds probe ─────────────────────
// One case per process, printing `{ status, body, list }` as the last stdout line.
// `meAttendanceBounds.test.ts` spawns it so the `mock.module` identity stubs stay
// out of the suite's shared module cache (a leaked mock is one-way in Bun, and
// which file lands first is filesystem readdir order — see tests/spawnProbe.ts).
//
// What runs REAL: `routes/me.ts`'s handlers, `lib/org/attendance.ts`,
// `lib/org/performance.ts`, `historyStore`'s wrapper, `requireVerifiedSelf`,
// `lib/users.resolveAuth0Id`, `lib/org/students.getLinkedPlayer`. Only two things
// are stubbed: the SQL connection (a recorder, because the question is what the
// QUERY was told) and `lib/redis`, which connects on import via me → queue → jobs.
//
// `DATABASE_URL` is left EMPTY on purpose: `historyStoreEnabled()` is `sql !== null`,
// and the recorder is installed through `setHistoryStoreConnectionForTests` AFTER
// import — so the handler's own `historyStoreEnabled()` sees the recorder and takes
// the linked-player path instead of short-circuiting to `linked: false`.

import { mock } from 'bun:test'
import type { SQL } from 'bun'

const VERIFIED = 'auth0|player-1'
const COACH = 'auth0|coach-1'
const STUDENT_ID = '00000000-0000-4000-8000-0000000000a1'

const probeCase = process.env.ME_ATT_CASE ?? ''

// ── Recorder ─────────────────────────────────────────────────────────────────
// Every statement, in order, as `{ sql, values }`. The joins are `?` so the text
// reads as the statement Postgres parses — one placeholder per interpolation.
type Statement = { sql: string; values: unknown[] }

const statements: Statement[] = []

const fixture = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join('?')
  statements.push({ sql, values })
  // `getLinkedPlayer`'s `select * from students where account_auth0_id = ?`.
  if (sql.includes('from students')) {
    return [{ id: STUDENT_ID, auth0_id: COACH, account_auth0_id: VERIFIED, full_name: 'Alex' }]
  }
  return []
}) as unknown as SQL

Object.assign(fixture, {
  connect: async () => {},
  unsafe: async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values })
    return []
  },
  close: async () => {},
})

// ── Identity / infrastructure stubs ──────────────────────────────────────────

mock.module('../src/lib/redis', () => ({
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: null,
}))
mock.module('../src/lib/audit', () => ({ auditRoute: () => undefined }))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { setHistoryStoreConnectionForTests } = await import('../src/lib/historyStore')
setHistoryStoreConnectionForTests(fixture)

const meRoute = (await import('../src/routes/me')).default

type Case = { path: string; query: string; expectList: boolean }

const CASES: Record<string, Case> = {
  bare: { path: '/api/me/attendance', query: '', expectList: true },
  explicitLimit: { path: '/api/me/attendance', query: '?limit=7', expectList: true },
  window: { path: '/api/me/attendance', query: '?from=2026-03-01&to=2026-03-31', expectList: true },
  garbageFrom: { path: '/api/me/attendance', query: '?from=not-a-date', expectList: false },
  blankFrom: { path: '/api/me/attendance', query: '?from=', expectList: false },
  garbageTo: { path: '/api/me/attendance', query: '?to=2026/03/31', expectList: false },
  // A well-formed but impossible date ("2026-13-45") is NOT in here: `isDate` is
  // pinned format-only ("calendar validity is left to the DB", orgValidate.test.ts),
  // so this route and the org route it mirrors both let it through to the cast.
  // Recorded here as a case so the residual is visible rather than forgotten.
  impossibleTo: { path: '/api/me/attendance', query: '?to=2026-13-45', expectList: true },
  instantFrom: {
    path: '/api/me/attendance',
    query: '?from=2026-03-01T00:00:00.000Z',
    expectList: false,
  },
  garbageStudent: {
    path: '/api/me/attendance',
    query: '?studentId=not-a-uuid',
    expectList: false,
  },
  otherStudent: {
    path: '/api/me/attendance',
    query: `?studentId=${'00000000-0000-4000-8000-0000000000ff'}`,
    expectList: true,
  },
  nonsenseLimit: { path: '/api/me/attendance', query: '?limit=abc', expectList: true },
  negativeLimit: { path: '/api/me/attendance', query: '?limit=-5', expectList: true },
  hugeLimit: { path: '/api/me/attendance', query: '?limit=1e999', expectList: true },
  perfBare: { path: '/api/me/performance', query: '', expectList: true },
  perfWindow: {
    path: '/api/me/performance',
    query: '?from=2026-03-01T00:00:00.000Z&to=2026-03-31T00:00:00.000Z',
    expectList: true,
  },
  perfGarbageFrom: { path: '/api/me/performance', query: '?from=not-a-date', expectList: false },
  perfBlankFrom: { path: '/api/me/performance', query: '?from=', expectList: false },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const response = await meRoute.handle(
  new Request(`http://localhost${probe.path}${probe.query}`, {
    headers: { 'x-verified-auth0-id': VERIFIED },
  }),
)

const body = await response.json().catch(() => null)

// Only the attendance rows: the player-scope lookups and the summary aggregate
// run alongside the list and must not be mistaken for it.
const list = statements.filter((s) => s.sql.includes('from attendance a'))

console.log(
  JSON.stringify({
    case: probeCase,
    path: probe.path,
    status: response.status,
    body,
    expectList: probe.expectList,
    list,
  }),
)
