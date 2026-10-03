import { mock } from 'bun:test'
import type { SQL } from 'bun'

// ── /api/me/schedule bounds probe ─────────────────────────────────────────────
// One case per process, printing `{ status, body, list }` as the last stdout line.
// `meScheduleBounds.test.ts` spawns it so the `mock.module` identity stubs stay
// out of the suite's shared module cache (a leaked mock is one-way in Bun, and
// which file lands first is filesystem readdir order — see tests/spawnProbe.ts).
//
// What runs REAL: `routes/me.ts`'s handler, `lib/org/schedule.ts`, `historyStore`'s
// wrapper, `requireVerifiedSelf`, `lib/users.resolveAuth0Id`, `lib/org/students.
// getLinkedPlayer`. Only two things are stubbed: the SQL connection (a recorder,
// because the question is what the QUERY was told) and `lib/redis`, which connects
// on import via me → queue → jobs.
//
// `DATABASE_URL` is left EMPTY on purpose: `historyStoreEnabled()` is `sql !== null`,
// and the recorder is installed through `setHistoryStoreConnectionForTests` AFTER
// import — so the handler's own `historyStoreEnabled()` sees the recorder and takes
// the linked-player path instead of short-circuiting to `linked: false`.

const VERIFIED = 'auth0|player-1'
const COACH = 'auth0|coach-1'
const STUDENT_ID = '00000000-0000-4000-8000-0000000000a1'

const probeCase = process.env.ME_SCHED_CASE ?? ''

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

// The scheduler reads the window off the query string and must pass it through
// only after validating it; `CASES` supplies the raw string so a garbage value
// really does reach the boundary.
type Case = { query: string; expectList: boolean }

const CASES: Record<string, Case> = {
  bare: { query: '', expectList: true },
  explicitLimit: { query: '?limit=7', expectList: true },
  window: { query: '?from=2026-03-01T00:00:00.000Z&to=2026-03-31T00:00:00.000Z', expectList: true },
  garbageFrom: { query: '?from=not-a-date', expectList: false },
  blankFrom: { query: '?from=', expectList: false },
  garbageTo: { query: '?to=2026-13-45', expectList: false },
  nonsenseLimit: { query: '?limit=abc', expectList: true },
  negativeLimit: { query: '?limit=-5', expectList: true },
  hugeLimit: { query: '?limit=1e999', expectList: true },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const response = await meRoute.handle(
  new Request(`http://localhost/api/me/schedule${probe.query}`, {
    headers: { 'x-verified-auth0-id': VERIFIED },
  }),
)

const body = await response.json().catch(() => null)

// Only the schedule statements: the player-scope lookups run first and must not
// be mistaken for the list.
const list = statements.filter((s) => s.sql.includes('from schedule_events'))

console.log(
  JSON.stringify({
    case: probeCase,
    status: response.status,
    body,
    expectList: probe.expectList,
    list,
  }),
)
