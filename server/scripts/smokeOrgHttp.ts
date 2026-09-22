// HTTP-level smoke test for the coach-organization platform. Boots the real
// route handlers in-process (no port), enables the identity guard, and walks
// every org / me / email endpoint with a random identity, asserting shape +
// status codes. Cleans up its own rows at the end.
//
//   cd server && SERVICE_TOKEN=smoke bun run scripts/smokeOrgHttp.ts
//
// Requires DATABASE_URL (live history store). RESEND_API_KEY is optional — the
// email routes are exercised and are expected to return EMAIL_NOT_CONFIGURED
// when no key is present (that is the correct, reachable value).

import { Elysia } from 'elysia'

import authRoute from '../src/routes/auth'
import orgRoute from '../src/routes/org'
import meRoute from '../src/routes/me'
import emailRoute from '../src/routes/email'
import { ensureInitialized, withHistoryStore } from '../src/lib/supabaseHistory'
import type { CoachAIError } from '../src/lib/errors'

if (!process.env.SERVICE_TOKEN) {
  console.error('SERVICE_TOKEN env not set — refusing to run with the guard disabled.')
  process.exit(1)
}

const app = new Elysia().use(authRoute).use(orgRoute).use(meRoute).use(emailRoute)

const base = 'http://smoke.test'
const token = process.env.SERVICE_TOKEN

const tag = `smokehttp-${Math.random().toString(36).slice(2, 8)}`
const coachId = `test|${tag}-coach`
const playerId = `test|${tag}-player`
const coachEmail = `${tag}+coach@example.com`
const playerEmail = `${tag}+player@example.com`
const playerName = 'Smoke Player'
let studentId = ''
let eventId = ''
let reportId = ''
let metricId = ''
let analysisId = ''

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`)
  }
}

async function call(
  method: string,
  path: string,
  opts: { identity?: string; body?: unknown; rawToken?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const pathResource = path.match(/\/api\/(?:org|email)\/([^/?]+)/)?.[1]
  const pathUser = path.match(/\/api\/auth\/user\/([^/?]+)/)?.[1]
  const bodySub =
    opts.body && typeof opts.body === 'object' && 'sub' in opts.body
      ? (opts.body as { sub: string }).sub
      : ''
  const identity = opts.identity ?? pathResource ?? pathUser ?? bodySub
  const res = await app.handle(
    new Request(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-service-token': opts.rawToken ?? token,
        'x-verified-auth0-id': identity,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  )
  let json: Record<string, unknown> | null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const expectError = (json: unknown): json is CoachAIError =>
  Boolean(
    json &&
    typeof json === 'object' &&
    typeof (json as CoachAIError).code === 'string' &&
    typeof (json as CoachAIError).layer === 'string',
  )

async function cleanup() {
  const ids: string[] = []
  if (studentId) ids.push(studentId)
  await withHistoryStore(async (db) => {
    await ensureInitialized()
    if (analysisId) {
      await db`delete from analysis_history where server_job_id = ${analysisId};`.catch(() => {})
    }
    if (ids.length) {
      await db`delete from students where id = any(${ids}::uuid[]);`.catch(() => {})
    }
    await db`delete from users where auth0_id in (${coachId}, ${playerId});`.catch(() => {})
    // cascade leftovers (metrics/reports/events/attendance) by coach scope
    await db`delete from performance_metrics where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from reports where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from schedule_events where auth0_id = ${coachId};`.catch(() => {})
    await db`delete from attendance where auth0_id = ${coachId};`.catch(() => {})
  }).catch(() => {})
  console.log('smoke_cleanup_done')
}

async function main() {
  await ensureInitialized()

  // ── Auth sync ────────────────────────────────────────────────────────────
  console.log('auth/sync')
  let r = await call('POST', '/api/auth/sync', {
    body: {
      sub: coachId,
      name: 'Smoke Coach',
      email: coachEmail,
      email_verified: true,
    },
  })
  check(
    'coach upsert returns user role=coach',
    r.status === 200 && r.json?.user?.role === 'coach',
    r.json,
  )

  // ── Students (before player sync so email link works) ────────────────────
  console.log('students')
  r = await call('GET', `/api/org/${coachId}/students`)
  check('list students (empty)', r.status === 200 && Array.isArray(r.json?.students), r.json)

  r = await call('POST', `/api/org/${coachId}/students`, {
    identity: coachId,
    body: {
      full_name: playerName,
      email: playerEmail,
      sport: 'basketball',
      position: 'PG',
      status: 'active',
      joined_on: '2026-01-15',
    },
  })
  check('create student → 201', r.status === 201 && r.json?.student?.id, r.json)
  studentId = r.json?.student?.id ?? ''

  r = await call('GET', `/api/org/${coachId}/students/${studentId}`, {
    identity: coachId,
  })
  check('get student', r.status === 200 && r.json?.student?.id === studentId, r.json)

  r = await call('PUT', `/api/org/${coachId}/students/${studentId}`, {
    identity: coachId,
    body: { jersey_number: 7, notes: 'rookie' },
  })
  check('update student', r.status === 200 && r.json?.student?.jersey_number === 7, r.json)

  r = await call('GET', `/api/org/${coachId}/students?search=Smoke&sport=basketball`)
  check('search students', r.status === 200 && r.json?.students?.length === 1, r.json)

  r = await call('GET', `/api/org/${coachId}/students/sports`)
  check('list sports', r.status === 200 && Array.isArray(r.json?.sports), r.json)

  // ── Player sync (AFTER student creation so the email link resolves) ─────
  console.log('player sync')
  r = await call('POST', '/api/auth/sync', {
    body: {
      sub: playerId,
      name: playerName,
      email: playerEmail,
      email_verified: true,
    },
  })
  check(
    'player upsert flips to role=player (email-linked)',
    r.status === 200 && r.json?.user?.role === 'player',
    r.json,
  )

  // ── Attendance ────────────────────────────────────────────────────────────
  console.log('attendance')
  r = await call('PUT', `/api/org/${coachId}/attendance`, {
    identity: coachId,
    body: {
      student_id: studentId,
      session_date: '2026-09-01',
      status: 'present',
      note: 'sharp',
    },
  })
  check('upsert attendance', r.status === 200 && r.json?.record?.status === 'present', r.json)

  r = await call('POST', `/api/org/${coachId}/attendance/batch`, {
    identity: coachId,
    body: {
      entries: [
        { student_id: studentId, session_date: '2026-09-02', status: 'late' },
        { student_id: studentId, session_date: '2026-09-03', status: 'absent' },
      ],
    },
  })
  check('batch attendance → count 2', r.status === 200 && r.json?.count === 2, r.json)

  r = await call('GET', `/api/org/${coachId}/attendance?from=2026-09-01&to=2026-09-30`)
  check('list attendance', r.status === 200 && r.json?.records?.length === 3, r.json)

  r = await call('GET', `/api/org/${coachId}/attendance/summary`)
  check(
    'attendance summary',
    r.status === 200 && typeof r.json?.summary?.attendance_rate === 'number',
    r.json,
  )

  // ── Schedule ──────────────────────────────────────────────────────────────
  console.log('schedule')
  r = await call('POST', `/api/org/${coachId}/schedule`, {
    identity: coachId,
    body: {
      title: 'Smoke Practice',
      event_type: 'practice',
      starts_at: '2026-09-10T16:00:00Z',
      status: 'scheduled',
    },
  })
  check('create event → 201', r.status === 201 && r.json?.event?.id, r.json)
  eventId = r.json?.event?.id ?? ''

  r = await call('PUT', `/api/org/${coachId}/schedule/${eventId}`, {
    identity: coachId,
    body: { status: 'completed' },
  })
  check('update event', r.status === 200 && r.json?.event?.status === 'completed', r.json)

  r = await call('GET', `/api/org/${coachId}/schedule`)
  check('list events', r.status === 200 && r.json?.events?.length === 1, r.json)

  // ── Performance metrics ───────────────────────────────────────────────────
  console.log('performance')
  r = await call('POST', `/api/org/${coachId}/students/${studentId}/performance`, {
    identity: coachId,
    body: {
      metric_key: 'vertical_jump',
      metric_value: 62,
      unit: 'cm',
      measured_at: '2026-09-05T10:00:00Z',
    },
  })
  check('create metric → 201', r.status === 201 && r.json?.metric?.id, r.json)
  metricId = r.json?.metric?.id ?? ''

  r = await call('GET', `/api/org/${coachId}/students/${studentId}/performance`)
  check('student performance series', r.status === 200 && r.json?.series?.length === 1, r.json)

  r = await call('PUT', `/api/org/${coachId}/performance/${metricId}`, {
    identity: coachId,
    body: { metric_value: 63, unit: 'cm' },
  })
  check('update metric', r.status === 200 && r.json?.metric?.metric_value === 63, r.json)

  r = await call('GET', `/api/org/${coachId}/performance?studentId=${studentId}`)
  check('cross-student list', r.status === 200 && r.json?.metrics?.length === 1, r.json)

  // ── Reports ───────────────────────────────────────────────────────────────
  console.log('reports')
  r = await call('POST', `/api/org/${coachId}/reports`, {
    identity: coachId,
    body: {
      student_id: studentId,
      report_type: 'progress',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
    },
  })
  check('create report → 201', r.status === 201 && r.json?.report?.id, r.json)
  reportId = r.json?.report?.id ?? ''

  r = await call('GET', `/api/org/${coachId}/reports/${reportId}`, {
    identity: coachId,
  })
  check('get report', r.status === 200 && r.json?.report?.id === reportId, r.json)

  r = await call('GET', `/api/org/${coachId}/reports?studentId=${studentId}`)
  check('list reports', r.status === 200 && r.json?.reports?.length >= 1, r.json)

  r = await call('PUT', `/api/org/${coachId}/reports/${reportId}`, {
    identity: coachId,
    body: { report_type: 'monthly' },
  })
  check('update report', r.status === 200 && r.json?.report?.report_type === 'monthly', r.json)

  // ── Analysis linking ──────────────────────────────────────────────────────
  console.log('analyses')
  analysisId = `srv-smoke-${tag}`
  await withHistoryStore(async (db) => {
    await ensureInitialized()
    await db`
      insert into analysis_history (server_job_id, engine_job_id, session_token, model, complete, video_ready, auth0_id, requested_at)
      values (${analysisId}, ${`eng-smoke-${tag}`}, ${`sess-smoke-${tag}`}, 'gemini-2.5-flash', true, false, ${coachId}, now())
      on conflict (server_job_id) do update set auth0_id = excluded.auth0_id;
    `
  })

  r = await call('PUT', `/api/org/${coachId}/analyses/${analysisId}/student`, {
    identity: coachId,
    body: { student_id: studentId },
  })
  check(
    'link analysis to student',
    r.status === 200 && r.json?.analysis?.student_id === studentId,
    r.json,
  )

  r = await call('GET', `/api/org/${coachId}/students/${studentId}/analyses`)
  check('student analyses', r.status === 200 && r.json?.analyses?.length === 1, r.json)

  r = await call('GET', `/api/auth/user/${coachId}/analyses?limit=20`)
  check(
    'auth analyses listing includes linked',
    r.status === 200 && r.json?.analyses?.length === 1,
    r.json,
  )

  r = await call('GET', `/api/auth/user/${coachId}/analyses?limit=100&unlinked=1`)
  check(
    'unlinked filter excludes linked analyses',
    r.status === 200 &&
      Array.isArray(r.json?.analyses) &&
      r.json.analyses.every((a) => !a.student_id),
    r.json,
  )

  // ── Overview + search ─────────────────────────────────────────────────────
  console.log('overview/search')
  r = await call('GET', `/api/org/${coachId}/overview`)
  check('overview counts', r.status === 200 && r.json?.overview?.student_count === 1, r.json)

  r = await call('GET', `/api/org/${coachId}/search?q=Smoke`)
  check('search students hit', r.status === 200 && r.json?.students?.length === 1, r.json)

  // ── Player (me) routes ────────────────────────────────────────────────────
  console.log('me routes')
  r = await call('GET', '/api/me/profile', { identity: playerId })
  check('me profile linked', r.status === 200 && r.json?.student?.id === studentId, r.json)

  r = await call('PUT', '/api/me/profile', {
    identity: playerId,
    body: { name: 'Smoke Player', nickname: 'SP', picture: null },
  })
  check(
    'me profile update (null picture clears)',
    r.status === 200 && r.json?.user?.picture === null,
    r.json,
  )

  r = await call('GET', '/api/me/attendance', { identity: playerId })
  check(
    'me attendance',
    r.status === 200 && r.json?.records?.length === 3 && r.json?.linked === true,
    r.json,
  )

  r = await call('GET', '/api/me/schedule', { identity: playerId })
  check('me schedule', r.status === 200 && r.json?.events?.length === 1, r.json)

  r = await call('GET', '/api/me/performance', { identity: playerId })
  check('me performance', r.status === 200 && r.json?.points?.length >= 1, r.json)

  r = await call('GET', '/api/me/analyses', { identity: playerId })
  check('me analyses', r.status === 200 && r.json?.analyses?.length === 1, r.json)

  r = await call('GET', '/api/me/reports', { identity: playerId })
  check('me reports', r.status === 200 && r.json?.reports?.length === 1, r.json)

  r = await call('GET', `/api/me/reports/${reportId}`, { identity: playerId })
  check('me report detail', r.status === 200 && r.json?.report?.id === reportId, r.json)

  // ── Email routes (reachable; expect 501 when no RESEND key) ───────────────
  console.log('email routes')
  r = await call('POST', `/api/email/${coachId}/invite`, {
    identity: coachId,
    body: { emails: ['sibling@example.com'] },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('invite → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else {
    check(
      'invite sent (RESEND key present)',
      r.status === 200 && r.json?.sent?.length === 1,
      r.json,
    )
  }

  r = await call('POST', `/api/email/${coachId}/report`, {
    identity: coachId,
    body: { report_id: reportId },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('report email → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else {
    check('report email sent (RESEND key present)', r.status === 200 && r.json?.sent, r.json)
  }

  r = await call('POST', `/api/email/${coachId}/attendance`, {
    identity: coachId,
    body: { from: '2026-09-01', to: '2026-09-30' },
  })
  if (r.status === 501 && expectError(r.json) && r.json.code === 'EMAIL_NOT_CONFIGURED') {
    check('attendance email → 501 EMAIL_NOT_CONFIGURED (no RESEND key)', true)
  } else {
    check(
      'attendance email sent (RESEND key present)',
      r.status === 200 && r.json?.records === 3,
      r.json,
    )
  }

  // ── Identity-boundary negatives ───────────────────────────────────────────
  console.log('identity boundary')
  r = await call('GET', `/api/org/${coachId}/students`, { identity: playerId })
  check('cross-account read → 403', r.status === 403 && expectError(r.json), r.json)

  r = await call('GET', `/api/org/${coachId}/students`, { identity: '' })
  check('missing verified identity → 403', r.status === 403 && expectError(r.json), r.json)

  r = await call('GET', `/api/org/${coachId}/students`, {
    identity: coachId,
    rawToken: 'wrong-token',
  })
  check('bad service token → 403', r.status === 403 && expectError(r.json), r.json)

  console.log(
    JSON.stringify({
      type: 'smoke_org_http',
      tag,
      passed,
      failed,
      emailConfigured: expectedEmailConfigured(),
    }),
  )
}

function expectedEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

main()
  .catch(async (e) => {
    failed++
    console.error(JSON.stringify({ type: 'smoke_org_http_error', error: String(e) }))
    await cleanup()
    process.exit(1)
  })
  .then(async () => {
    await cleanup()
    process.exit(failed > 0 ? 1 : 0)
  })
