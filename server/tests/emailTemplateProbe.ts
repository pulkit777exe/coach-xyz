import { mock } from 'bun:test'

// ── The email templates, end to end, with only the HTTP call intercepted ─────
//
// Why this file exists at all: `emailRouteGuardsProbe.ts` replaces the WHOLE
// mailer module, so every template is a constant stub (`inviteEmail: () => ({…})`)
// and `sendEmail` records only `to` and `html`. That shape cannot see either half
// of the escaping defect:
//
//   - it cannot see INJECTION, because the templates that would have to escape
//     are not the ones running;
//   - it cannot see the PLAIN-TEXT half, which is the one with a user-visible
//     symptom: the callers pre-escaped, so a coach named `Tom & Jerry` produced
//     the subject line "Tom &amp; Jerry invited you to ..." in every mail
//     client, notification list and sent-mail search.
//
// So nothing mocked here except the transport. `routes/email.ts` runs for real,
// the templates in `lib/mailer.ts` run for real, `sendEmail` runs for real, and
// only `fetch` is replaced — which means the assertion is on the exact JSON body
// Resend would have received. `mock.module` is still used, but only to keep the
// identity and org-data lookups off the network; per AGENTS.md the mocks are
// installed BEFORE the dynamic import, because static imports evaluate first and
// the mocks would then apply to nothing.
//
// The database is NOT mocked or needed: every lookup below is short-circuited by
// the stubs, so this runs with no `DATABASE_URL` at all.

const HOSTILE = 'Tom & Jerry <script>alert(1)</script>'

type Sent = { to: string; subject: string; html: string; text: string }
const sent: Sent[] = []

// ── The transport, and nothing above it ─────────────────────────────────────
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    to: string[]
    subject: string
    html: string
    text: string
  }
  sent.push({ to: body.to[0] ?? '', subject: body.subject, html: body.html, text: body.text })
  return new Response(JSON.stringify({ id: 'stub' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}) as unknown as typeof fetch

process.env.RESEND_API_KEY = 'probe-key'

const OWNER = 'auth0|email-template-probe-owner'
const RECIPIENT = 'player@probe.local'

// The coach's own name carries the hostile characters, so every template that
// interpolates it exercises the escaping.
mock.module('../src/lib/users', () => ({
  getUserByAuth0Id: async () => ({
    auth0_id: OWNER,
    name: HOSTILE,
    nickname: null,
    email: 'c@x.y',
  }),
}))
// SPREAD THE REAL module and override only what this probe needs. Enumerating
// exports is the trap AGENTS.md names: a partial `mock.module` fails the whole
// process with "Export named 'getReport' not found" the moment the route — or any
// module it imports — reaches for something the list forgot. The first version of
// this file did exactly that, and it is the same failure the `setStudentTeam`
// rename caused across nine probes.
const actualOrgData = await import('../src/lib/orgData')
const actualHistoryStore = await import('../src/lib/historyStore')

const PLAYER = '11111111-1111-4111-8111-111111111111'
const attendanceRow = {
  student_id: PLAYER,
  full_name: HOSTILE,
  status: 'present',
  session_date: '2026-03-02',
  note: null,
}

mock.module('../src/lib/orgData', () => ({
  ...actualOrgData,
  listStudents: async () => [{ id: PLAYER, email: RECIPIENT }],
  getStudent: async () => ({ id: PLAYER, email: RECIPIENT }),
  listAttendance: async () => [attendanceRow],
  getAttendanceRecords: async () => [attendanceRow],
  getReport: async () => ({
    id: '22222222-2222-4222-8222-222222222222',
    // Attached to the player, deliberately. An ORG-LEVEL report (student_id null)
    // can only be mailed by an org-wide caller, and those no longer supply `to` —
    // there is no student address to derive — so this fixture could not exercise
    // the template at all. `reportEmail` interpolates the same fields either way,
    // so escaping coverage is unchanged, and the org-level refusal is the
    // matrix's business rather than this probe's.
    student_id: PLAYER,
    title: HOSTILE,
    // The summary carries markup: a template that trusted it would render it.
    content_json: { summary: `<b>${HOSTILE}</b>` },
  }),
}))
mock.module('../src/lib/historyStore', () => ({
  ...actualHistoryStore,
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => fn(() => []),
}))
mock.module('../src/lib/audit', () => ({ auditRoute: () => undefined }))
mock.module('../src/lib/redis', () => ({
  redis: null,
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
}))

const emailRoute = (await import('../src/routes/email')).default

const call = async (path: string, body: unknown) =>
  emailRoute.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-verified-auth0-id': OWNER },
      body: JSON.stringify(body),
    }),
  )

// NOT `/api/org/:id/email/...` — these are mounted at `/api/email/:auth0Id/...`.
const base = `/api/email/${encodeURIComponent(OWNER)}`

for (const [path, body] of [
  // The bodies are the routes' own contract, read from the handlers: `emails`
  // (not `to`), and the report route is keyed by `report_id`.
  [`${base}/invite`, { emails: [RECIPIENT], student_ids: [] }],
  [`${base}/report`, { report_id: '22222222-2222-4222-8222-222222222222', to: RECIPIENT }],
  [`${base}/attendance`, { from: '2026-03-01', to: '2026-03-07', recipient: RECIPIENT }],
] as const) {
  const res = await call(path, body)
  // A refusal here means the probe stopped exercising the template, so make it
  // loud rather than reporting an empty `sent` list three assertions later.
  if (res.status >= 400) {
    console.error(`probe route refused: ${path} -> ${res.status} ${await res.text()}`)
    process.exit(1)
  }
}

console.log(JSON.stringify({ sent }))
